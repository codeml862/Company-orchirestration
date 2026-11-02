import secrets
import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import SUPERVISOR_ROLES, current_user, require_admin, require_staff
from app.models import Client, User, UserRole, utcnow
from app.schemas import (
    ClientCreate,
    ClientOut,
    ClientUpdate,
    GoogleLoginRequest,
    GoogleSignupRequest,
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    SignupRequest,
    TokenResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.security import create_access_token, hash_password, verify_google_id_token, verify_password

router = APIRouter(prefix="/api", tags=["auth"])


def _sign_in(db: Session, user: User, method: str) -> TokenResponse:
    user.last_login_at = utcnow()
    audit.record(
        db,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        actor_type="user",
        actor_id=user.id,
        client_id=user.client_id,
        message=f"{user.email} signed in" + (" with Google" if method == "google" else ""),
        details={"method": method},
    )
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    return _sign_in(db, user, "password")


@router.get("/auth/providers")
def auth_providers():
    """Sign-in methods the login page offers. A Google client ID is public, not a secret."""
    settings = get_settings()
    return {"google_client_id": settings.google_client_id or None, "signup_enabled": settings.allow_signup}


def _google_identity(credential: str) -> dict:
    """Verify a Google ID token and return its claims, with a lowercased, verified `email`."""
    client_id = get_settings().google_client_id
    if not client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Google sign-in is not enabled")
    try:
        claims = verify_google_id_token(credential, client_id)
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "could not reach Google to verify sign-in") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid Google credential") from exc
    email = str(claims.get("email") or "").lower()
    if not email or claims.get("email_verified") is not True:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "this Google account has no verified email address")
    return {**claims, "email": email}


@router.post("/auth/google", response_model=TokenResponse)
def login_with_google(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Sign in with a Google ID token. Only existing, active users with a matching verified email may sign in."""
    email = _google_identity(body.credential)["email"]
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        hint = "create an account first" if get_settings().allow_signup else "ask an administrator to invite you"
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"no active Orchestria account uses {email}; {hint}")
    return _sign_in(db, user, "google")


# --------------------------------------------------------------------------- self-service sign-up
# Sign-up registers a new client company and its first (client) user. Staff accounts are only ever
# created by an administrator, and new clients start on local models only (allow_external_llm=False).


def _register_client(db: Session, *, company_name: str, full_name: str, email: str, password: str, method: str) -> User:
    if not get_settings().allow_signup:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "self-service sign-up is disabled; ask an administrator")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "an account with this email already exists; sign in instead")
    client = Client(name=company_name, contact_email=email)
    db.add(client)
    db.flush()
    user = User(
        email=email,
        full_name=full_name,
        role=UserRole.CLIENT,
        client_id=client.id,
        password_hash=hash_password(password),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # the same email signed up concurrently
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "an account with this email already exists") from exc
    audit.record(
        db,
        action="client.signed_up",
        entity_type="client",
        entity_id=client.id,
        actor_type="user",
        actor_id=user.id,
        client_id=client.id,
        message=f"{client.name} signed up ({email}" + (", with Google)" if method == "google" else ")"),
        details={"method": method, "user_id": str(user.id)},
    )
    return user


@router.post("/auth/signup", response_model=TokenResponse, status_code=201)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    user = _register_client(
        db,
        company_name=body.company_name,
        full_name=body.full_name,
        email=body.email.lower(),
        password=body.password,
        method="password",
    )
    return _sign_in(db, user, "password")


@router.post("/auth/google/signup", response_model=TokenResponse, status_code=201)
def signup_with_google(body: GoogleSignupRequest, db: Session = Depends(get_db)):
    claims = _google_identity(body.credential)
    email = claims["email"]
    user = _register_client(
        db,
        company_name=body.company_name,
        full_name=str(claims.get("name") or email.split("@")[0])[:200],
        email=email,
        # Google accounts sign in through Google; this random password is never shown to anyone.
        password=secrets.token_urlsafe(32),
        method="google",
    )
    return _sign_in(db, user, "google")


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.patch("/auth/me", response_model=UserOut)
def update_me(body: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Change your own display name."""
    user.full_name = body.full_name
    audit.record(
        db,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        actor_type="user",
        actor_id=user.id,
        client_id=user.client_id,
        message=f"{user.email} updated their profile",
        details={"fields": ["full_name"]},
    )
    db.commit()
    return user


@router.post("/auth/me/password", status_code=204)
def change_password(body: PasswordChange, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Change your own password; the current one is required."""
    if user.email == get_settings().bootstrap_admin_email.strip().lower():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "this admin's password is set in backend/.env (AICO_BOOTSTRAP_ADMIN_PASSWORD); change it there and restart",
        )
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "your current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(422, "choose a password different from the current one")
    user.password_hash = hash_password(body.new_password)
    audit.record(
        db,
        action="user.password_changed",
        entity_type="user",
        entity_id=user.id,
        actor_type="user",
        actor_id=user.id,
        client_id=user.client_id,
        message=f"{user.email} changed their password",
    )
    db.commit()
    return Response(status_code=204)


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


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    # null means "no change", except for client_id, which follows the role.
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k == "client_id"}
    if user.id == admin.id and (changes.get("is_active") is False or changes.get("role", user.role) != UserRole.ADMIN):
        raise HTTPException(422, "you cannot deactivate or demote your own account")
    role = changes.get("role", user.role)
    client_id = changes["client_id"] if "client_id" in changes else user.client_id
    if role == UserRole.CLIENT:
        if client_id is None:
            raise HTTPException(422, "client users need a client_id")
        if db.get(Client, client_id) is None:
            raise HTTPException(422, "unknown client_id")
    else:
        client_id = None
    password = changes.pop("password", None)
    for field in ("full_name", "role", "is_active"):
        if field in changes:
            setattr(user, field, changes[field])
    user.client_id = client_id
    if password:
        user.password_hash = hash_password(password)
    audit.record(
        db,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        actor_type="user",
        actor_id=admin.id,
        message=f"User {user.email} updated",
        details={"fields": sorted([*changes, *(["password"] if password else [])])},
    )
    db.commit()
    return user


def _check_can_set_autonomy(user: User) -> None:
    """How much the autopilot may decide for a client is a governance decision, like approvals."""
    if user.role not in SUPERVISOR_ROLES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "only a supervisor or admin can change a client's autonomy level"
        )


@router.get("/clients", response_model=list[ClientOut])
def list_clients(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    return db.scalars(select(Client).order_by(Client.name)).all()


@router.post("/clients", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    if body.autonomy_level is not None:
        _check_can_set_autonomy(user)
    client = Client(**body.model_dump(exclude_none=True))
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


@router.patch("/clients/{client_id}", response_model=ClientOut)
def update_client(
    client_id: uuid.UUID, body: ClientUpdate, db: Session = Depends(get_db), user: User = Depends(require_staff)
):
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(404, "client not found")
    # null means "no change", except for contact_email, which may be cleared.
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k == "contact_email"}
    if changes.get("autonomy_level", client.autonomy_level) != client.autonomy_level:
        _check_can_set_autonomy(user)
    for field, value in changes.items():
        setattr(client, field, value)
    audit.record(
        db,
        action="client.updated",
        entity_type="client",
        entity_id=client.id,
        actor_type="user",
        actor_id=user.id,
        client_id=client.id,
        message=f"Client {client.name} updated: {', '.join(sorted(changes)) or 'nothing'}",
        details={k: str(v) for k, v in changes.items()},
    )
    db.commit()
    return client
