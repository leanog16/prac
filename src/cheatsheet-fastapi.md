## Routes and parameters

```python
from typing import Annotated
from fastapi import FastAPI, Path, Query, Header, HTTPException, status

app = FastAPI()

@app.get("/items/{item_id}")
def get_item(
    item_id: Annotated[int, Path(ge=1)],                 # path parameter
    q: Annotated[str | None, Query(max_length=50)] = None,   # optional query
    limit: int = 20,                                      # query with default
    x_request_id: Annotated[str | None, Header()] = None, # header X-Request-ID
):
    ...
```

| Declared as | Comes from |
|---|---|
| name in the path `{x}` | path |
| simple type, not in path | query string |
| Pydantic model | JSON body |
| `Header()` / `Cookie()` / `Form()` / `File()` / `UploadFile` | header / cookie / form field / upload |
| `Depends(fn)` | a dependency |

## Models

```python
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, computed_field

class ItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    price: float = Field(gt=0)
    tags: list[str] = []

    @field_validator("name")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

class ItemOut(ItemIn):
    id: int

@app.post("/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create(item: ItemIn): ...
```

`model_dump()`, `model_dump(exclude_unset=True)` (PATCH), `model_validate(obj)`, `model_copy(update={...})`.

## Status codes and errors

| Code | Use |
|---|---|
| 200 / 201 / 204 | OK / created / no content |
| 400 / 401 / 403 / 404 / 409 / 422 / 429 | bad request / not authenticated / forbidden / not found / conflict / validation / rate limited |
| 500 / 503 | bug / dependency down |

```python
raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")

@app.exception_handler(DomainError)
async def handle(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})
```

## Dependencies

```python
def get_db():
    db = SessionLocal()
    try:
        yield db                     # teardown after the response
    finally:
        db.close()

DB = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
app.include_router(router)
```

Tests: `app.dependency_overrides[get_db] = lambda: test_db`.

## Auth

```python
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    return payload["sub"]
```

Hash passwords (argon2/bcrypt via `pwdlib`), short-lived tokens, `Security(dep, scopes=[...])` for scopes.

## Lifespan, files, streaming

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=5)
    yield
    await app.state.http.aclose()

app = FastAPI(lifespan=lifespan)

@app.post("/upload")
async def upload(file: UploadFile, title: Annotated[str, Form()]): data = await file.read()

return FileResponse(path, filename="report.pdf")
return StreamingResponse(gen(), media_type="text/csv")
app.mount("/static", StaticFiles(directory="static"), name="static")
```

## Async

| Write | When |
|---|---|
| `async def` | only non-blocking libraries inside (`await httpx…`, `AsyncSession`) |
| `def` | blocking libraries (`requests`, sync SQLAlchemy, boto3): runs in a thread pool |
| `await asyncio.to_thread(fn, x)` | one blocking call inside async code |
| `await asyncio.gather(a(), b())` | concurrent I/O |

WebSockets: `@app.websocket("/ws")`, `await ws.accept()`, `receive_text()`, `send_text()`, catch `WebSocketDisconnect`.

## Database (SQLModel)

```python
class Hero(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)

session.add(hero); session.commit(); session.refresh(hero)
session.get(Hero, 1)
session.exec(select(Hero).where(Hero.name == "Ada").offset(0).limit(20)).all()
```

Migrations: Alembic (`alembic revision --autogenerate -m "…"`, `alembic upgrade head`).

## Testing

```python
from fastapi.testclient import TestClient

def test_create():
    with TestClient(app) as client:          # runs lifespan
        r = client.post("/items", json={"name": "Lamp", "price": 10})
        assert r.status_code == 201
        assert r.json()["name"] == "Lamp"
```

## Production

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers
```

`/health` (liveness, no dependencies) and `/ready` (checks DB); request-ID middleware; JSON logs; CORS with exact origins; rate-limit login; settings via `pydantic-settings`.
