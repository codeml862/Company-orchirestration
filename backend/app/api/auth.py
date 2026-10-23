from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.db import get_db
from app.deps import current_user, require_admin, require_staff
from app.models import Client, User, UserRole, utcnow
from app.schemas import ClientCreate, ClientOut, LoginRequest, TokenResponse, UserCreate, UserOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    user.last_login_at = utcnow()
    audit.record(
        db,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        actor_type="user",
        actor_id=user.id,
        client_id=user.client_id,
        message=f"{user.email} signed in",
    )
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.scalars(select(User).order_by(User.created_at)).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if body.role == UserRole.CLIENT and body.client_id is None:
        raise HTTPException(422, "client users need a client_id")
    if body.client_id is not None and db.get(Client, body.client_id) is None:
        raise HTTPException(422, "unknown client_id")
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "a user with this email already exists")
    user = User(
        email=body.email.lower(),
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role=body.role,
        client_id=body.client_id if body.role == UserRole.CLIENT else None,
    )
    db.add(user)
    db.flush()
    audit.record(
        db,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        actor_type="user",
        actor_id=admin.id,
        message=f"User {user.email} created with role {user.role}",
    )
    db.commit()
    return user


@router.get("/clients", response_model=list[ClientOut])
def list_clients(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    return db.scalars(select(Client).order_by(Client.name)).all()


@router.post("/clients", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    client = Client(**body.model_dump())
    db.add(client)
    db.flush()
    audit.record(
        db,
        action="client.created",
        entity_type="client",
        entity_id=client.id,
        actor_type="user",
        actor_id=user.id,
        client_id=client.id,
        message=f"Client {client.name} created",
    )
    db.commit()
    return client
