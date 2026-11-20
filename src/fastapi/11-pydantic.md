---
id: fastapi-pydantic
title: Pydantic in depth
summary: Field validators and model validators, before/after modes, computed fields, aliases and camelCase APIs, model_config (strict, extra='forbid', from_attributes, frozen), discriminated unions, and reusable Annotated types.
minutes: 35
---
> [!project] Taskboard, step 12: business rules in the models
> Taskboard gains due dates and tags, and with them, rules: a due date can't be in the past, tags are normalized, and a task can't be `done` without a completion note. Validators enforce them before any endpoint code runs.

## When Field() isn't enough

`Field(min_length=3, ge=0)` handles single-value constraints. Real rules are messier: "the slug must be lowercase", "end date must be after start date", "either email or phone is required". Pydantic v2 gives you **validators** for these, and FastAPI turns any validator error into the same 422 response as a built-in constraint.

## Field validators

A `@field_validator` runs for one or more fields. It receives the value and returns the (possibly cleaned) value, or raises `ValueError`:

```python
from pydantic import BaseModel, field_validator


class Signup(BaseModel):
    username: str
    email: str

    @field_validator("username")
    @classmethod
    def username_rules(cls, v: str) -> str:
        if not v.isalnum():
            raise ValueError("username must be letters and digits only")
        return v.lower()                 # normalize: validators can transform

    @field_validator("email")
    @classmethod
    def email_has_at(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("not an email address")
        return v.strip()
```

- Validators are **class methods**; put `@field_validator` on top and `@classmethod` under it.
- **Return the value.** Forgetting `return v` silently sets the field to `None`.
- Raise `ValueError` (or `AssertionError`), not `HTTPException`: Pydantic collects every error and FastAPI reports them all with their field locations.

### before vs after

By default a validator runs **after** Pydantic has parsed and type-checked the value (`mode="after"`), so `v` is already a `str` or `int`. `mode="before"` runs on the **raw input**, before type conversion. Use it to accept extra input shapes:

```python
class Query(BaseModel):
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def split_commas(cls, v):
        if isinstance(v, str):           # accept "a,b,c" as well as ["a", "b", "c"]
            return [t.strip() for t in v.split(",")]
        return v
```

## Model validators: rules across fields

When a rule involves more than one field, use `@model_validator(mode="after")`. It receives the fully built model (`self`) and must return it:

```python
from datetime import date
from typing import Self
from pydantic import BaseModel, model_validator


class Booking(BaseModel):
    check_in: date
    check_out: date

    @model_validator(mode="after")
    def dates_in_order(self) -> Self:
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self
```

## Computed fields

A `@computed_field` is a property that's included when the model is serialized, so it shows up in responses and in the OpenAPI schema:

```python
from pydantic import BaseModel, computed_field


class LineItem(BaseModel):
    unit_price: float
    quantity: int

    @computed_field
    @property
    def total(self) -> float:
        return round(self.unit_price * self.quantity, 2)
```

`LineItem(unit_price=2.5, quantity=4).model_dump()` → `{"unit_price": 2.5, "quantity": 4, "total": 10.0}`.

## Aliases: camelCase on the wire, snake_case in Python

JavaScript clients expect `firstName`; Python code wants `first_name`. An **alias generator** maps every field:

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Profile(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    first_name: str
    last_name: str
```

The model accepts `{"firstName": "Ada", "lastName": "Lovelace"}`. `populate_by_name=True` also allows `first_name=` in Python code. When FastAPI serializes a `response_model`, it uses the aliases (`by_alias=True`) by default, so responses come out camelCase too. For a single field, use `Field(alias="firstName")`.

## model_config: model-wide behavior

| Setting | Effect |
|---|---|
| `extra="forbid"` | unknown keys are a 422 instead of being silently dropped: catches client typos like `"emial"` |
| `extra="ignore"` | (default) unknown keys are dropped |
| `strict=True` | no type coercion: `"5"` is no longer accepted for an `int` |
| `frozen=True` | instances are immutable (and hashable) |
| `from_attributes=True` | build from any object's attributes: `Model.model_validate(orm_row)` |
| `str_strip_whitespace=True` | strip every string field |

```python
class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str | None = None
    bio: str | None = None
```

## Discriminated unions

An endpoint that accepts several shapes (a payment by card **or** by bank transfer) can use a union with a **discriminator** field. Pydantic reads the discriminator first and validates against exactly one model, which is faster and gives clear errors:

```python
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field


class Card(BaseModel):
    method: Literal["card"]
    number: str
    cvc: str


class Bank(BaseModel):
    method: Literal["bank"]
    iban: str


Payment = Annotated[Union[Card, Bank], Field(discriminator="method")]


@app.post("/payments")
def pay(payment: Payment):
    return {"method": payment.method}
```

## Reusable constrained types

Repeating `Field(min_length=3, max_length=30, pattern=...)` across models is error-prone. Name the type once with `Annotated`:

```python
from typing import Annotated
from pydantic import AfterValidator, Field

Slug = Annotated[str, Field(min_length=3, max_length=40, pattern=r"^[a-z0-9-]+$")]
Percent = Annotated[float, Field(ge=0, le=100)]


def no_spaces(v: str) -> str:
    if " " in v:
        raise ValueError("no spaces allowed")
    return v

Username = Annotated[str, AfterValidator(no_spaces)]


class Post(BaseModel):
    slug: Slug
    author: Username
```

## Worked example: where should a rule live?

| Rule | Where | Why |
|---|---|---|
| title 1–120 characters | `Field(min_length=1, max_length=120)` | a single-field constraint |
| tags are lowercase, trimmed, unique | `field_validator("tags")` | transforms one field |
| `due_date` not in the past | `field_validator("due_date")` | needs custom logic, one field |
| `done` requires a `completion_note` | `model_validator(mode="after")` | involves two fields |
| title unique among open tasks | the endpoint / service (409) | needs the **database** |

Validators should only use the data in front of them. Rules that need other records belong in the service layer.

```python
from datetime import date
from typing import Self
from pydantic import BaseModel, Field, field_validator, model_validator

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    due_date: date | None = None
    tags: list[str] = []

    @field_validator("title")
    @classmethod
    def strip_title(cls, v: str) -> str:
        return v.strip()

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, v: list[str]) -> list[str]:
        return sorted({t.strip().lower() for t in v if t.strip()})

    @field_validator("due_date")
    @classmethod
    def not_in_past(cls, v: date | None) -> date | None:
        if v is not None and v < date.today():
            raise ValueError("due_date can't be in the past")
        return v
```

A client sending `{"title": "  Fix login  ", "tags": ["Bug", "bug ", "UI"]}` gets a task titled `Fix login` with tags `["bug", "ui"]`. Clients can be sloppy, but your data stays clean.

> [!plain] In plain English
> Validators are methods Pydantic calls while building the model. They can reject the value (raise `ValueError`, which becomes a 422) or clean it up (return a new value).

## Common mistakes

> [!mistake] Validators with side effects
> Don't query the database, call APIs or send emails from a validator. Validation can run many times (including in tests and serialization), and it should be fast and pure.

:::quiz
q: A `@field_validator` checks the value but forgets `return v`. What happens?
- Pydantic raises a configuration error at import time
- the original value is kept
+ the field ends up `None`, because the validator's return value replaces the input
- FastAPI returns 500
why: The validator's return value becomes the field value. Always return it.
:::

:::quiz
q: Which validator should check that `end_date` is after `start_date`?
- a `field_validator("end_date", mode="before")`
+ a `model_validator(mode="after")`
- a computed_field
- `Field(gt=start_date)`
why: Cross-field rules need the whole model, which is what an after-mode model validator receives.
:::

:::quiz
q: A request body has an unexpected key `"emial"`. With the default config, what happens?
+ the key is silently ignored and the request succeeds
- 422 Unprocessable Entity
- 400 Bad Request
- the key is stored as an extra attribute
why: The default is `extra="ignore"`. Set `extra="forbid"` to turn typos into 422 errors.
:::

:::quiz
q: What does `mode="before"` change about a field validator?
- it runs before the request reaches FastAPI
+ it receives the raw input before Pydantic's type conversion
- it runs before the other validators of the model are defined
- it can't raise errors
why: Before-validators see whatever the client sent, which is useful for accepting extra input formats.
:::

:::exercise
id: pv-field
level: 2
title: Normalize a username
mode: code
lang: python
file: models.py
---
Add a field validator for `username` that raises `ValueError("too short")` if the value is shorter than 3 characters, and otherwise returns it **lowercased**.
---starter
from pydantic import BaseModel, field_validator


class Signup(BaseModel):
    username: str
    password: str
---rule
@field_validator\(\s*["']username["']\s*\)\s*\n\s*@classmethod
`@field_validator("username")` then `@classmethod`
---rule
def\s+\w+\(\s*cls\s*,\s*(v|value)\b
A classmethod taking `cls, v`
---rule
len\(\s*(v|value)\s*\)\s*<\s*3
Check the length
---rule
raise\s+ValueError\(\s*["']too short["']\s*\)
`raise ValueError("too short")`
---rule
return\s+(v|value)\.lower\(\s*\)
Return the lowercased value
---solution
from pydantic import BaseModel, field_validator


class Signup(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("too short")
        return v.lower()
:::

:::exercise
id: pv-model
level: 3
title: Price range in order
mode: code
lang: python
file: models.py
---
Add an after-mode model validator to `PriceFilter` that raises `ValueError("min_price must be <= max_price")` when **both** values are set and `min_price > max_price`, and returns `self` otherwise.
---starter
from typing import Self

from pydantic import BaseModel, model_validator


class PriceFilter(BaseModel):
    min_price: float | None = None
    max_price: float | None = None
---rule
@model_validator\(\s*mode\s*=\s*["']after["']\s*\)
`@model_validator(mode="after")`
---rule
def\s+\w+\(\s*self\s*\)
An instance method taking `self`
---rule
self\.min_price\s+is\s+not\s+None[\s\S]*self\.max_price\s+is\s+not\s+None|self\.max_price\s+is\s+not\s+None[\s\S]*self\.min_price\s+is\s+not\s+None
Only check when both are set
---rule
self\.min_price\s*>\s*self\.max_price|self\.max_price\s*<\s*self\.min_price
Compare the two
---rule
raise\s+ValueError\(\s*["']min_price must be <= max_price["']\s*\)
Raise the error message
---rule
return\s+self
Return `self`
---solution
from typing import Self

from pydantic import BaseModel, model_validator


class PriceFilter(BaseModel):
    min_price: float | None = None
    max_price: float | None = None

    @model_validator(mode="after")
    def check_range(self) -> Self:
        if self.min_price is not None and self.max_price is not None and self.min_price > self.max_price:
            raise ValueError("min_price must be <= max_price")
        return self
:::

:::exercise
id: pv-before
level: 3
title: Accept comma-separated tags
mode: code
lang: python
file: models.py
---
Make `tags` accept either a list **or** a comma-separated string like `"a, b,c"`. Add a **before**-mode field validator that splits a `str` on commas and strips each part; other values are returned unchanged.
---starter
from pydantic import BaseModel, field_validator


class Article(BaseModel):
    title: str
    tags: list[str] = []
---rule
@field_validator\(\s*["']tags["']\s*,\s*mode\s*=\s*["']before["']\s*\)
`@field_validator("tags", mode="before")`
---rule
@classmethod
`@classmethod`
---rule
isinstance\(\s*(v|value)\s*,\s*str\s*\)
Detect a string
---rule
\.split\(\s*["'],["']\s*\)
Split on commas
---rule
\.strip\(\s*\)
Strip each part
---rule
return\s+(v|value)\s*$
Return other values unchanged
---solution
from pydantic import BaseModel, field_validator


class Article(BaseModel):
    title: str
    tags: list[str] = []

    @field_validator("tags", mode="before")
    @classmethod
    def split_tags(cls, v):
        if isinstance(v, str):
            return [t.strip() for t in v.split(",")]
        return v
:::

:::exercise
id: pv-computed
level: 2
title: A computed total
mode: code
lang: python
file: models.py
---
Add a computed field `total` to `CartLine` that returns `price * quantity` rounded to 2 decimals.
---starter
from pydantic import BaseModel, computed_field


class CartLine(BaseModel):
    price: float
    quantity: int
---rule
@computed_field\s*\n\s*@property
`@computed_field` then `@property`
---rule
def\s+total\(\s*self\s*\)
`def total(self)`
---rule
round\(\s*self\.price\s*\*\s*self\.quantity\s*,\s*2\s*\)|round\(\s*self\.quantity\s*\*\s*self\.price\s*,\s*2\s*\)
`round(self.price * self.quantity, 2)`
---solution
from pydantic import BaseModel, computed_field


class CartLine(BaseModel):
    price: float
    quantity: int

    @computed_field
    @property
    def total(self) -> float:
        return round(self.price * self.quantity, 2)
:::

:::exercise
id: pv-config
level: 2
title: Strict input, camelCase output
mode: code
lang: python
file: models.py
---
Configure `Customer` so that unknown keys are **rejected**, fields use **camelCase aliases** via `to_camel`, and Python code can still populate fields by their snake_case names.
---starter
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Customer(BaseModel):
    first_name: str
    last_name: str
    phone_number: str | None = None
---rule
model_config\s*=\s*ConfigDict\(
`model_config = ConfigDict(...)`
---rule
extra\s*=\s*["']forbid["']
`extra="forbid"`
---rule
alias_generator\s*=\s*to_camel
`alias_generator=to_camel`
---rule
populate_by_name\s*=\s*True|validate_by_name\s*=\s*True
`populate_by_name=True`
---solution
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Customer(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)

    first_name: str
    last_name: str
    phone_number: str | None = None
:::

:::exercise
id: pv-union
level: 3
title: Two kinds of notification
mode: code
lang: python
file: models.py
---
Define `Notification` as a **discriminated union** of `EmailNote` and `SmsNote`, discriminated by the field `channel`. Give `EmailNote` the field `channel: Literal["email"]` and `SmsNote` the field `channel: Literal["sms"]`.
---starter
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class EmailNote(BaseModel):
    to: str
    subject: str


class SmsNote(BaseModel):
    phone: str
    text: str
---rule
class\s+EmailNote\(BaseModel\):[\s\S]*?channel\s*:\s*Literal\[\s*["']email["']\s*\]
`EmailNote.channel: Literal["email"]`
---rule
class\s+SmsNote\(BaseModel\):[\s\S]*?channel\s*:\s*Literal\[\s*["']sms["']\s*\]
`SmsNote.channel: Literal["sms"]`
---rule
Notification\s*=\s*Annotated\[\s*(Union\[\s*EmailNote\s*,\s*SmsNote\s*\]|EmailNote\s*\|\s*SmsNote)\s*,\s*Field\(\s*discriminator\s*=\s*["']channel["']\s*\)\s*\]
`Notification = Annotated[Union[EmailNote, SmsNote], Field(discriminator="channel")]`
---solution
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class EmailNote(BaseModel):
    channel: Literal["email"]
    to: str
    subject: str


class SmsNote(BaseModel):
    channel: Literal["sms"]
    phone: str
    text: str


Notification = Annotated[Union[EmailNote, SmsNote], Field(discriminator="channel")]
:::

:::exercise
id: pv-annotated-type
level: 2
title: A reusable constrained type
mode: code
lang: python
file: types.py
---
Define `Sku = Annotated[str, Field(pattern=r"^[A-Z]{3}-\d{4}$")]` and use it as the type of `sku` in `Product`.
---starter
from typing import Annotated

from pydantic import BaseModel, Field


class Product(BaseModel):
    sku: str
    name: str
---rule
Sku\s*=\s*Annotated\[\s*str\s*,\s*Field\(\s*pattern\s*=\s*r?["']\^\[A-Z\]\{3\}-\\d\{4\}\$["']\s*\)\s*\]
`Sku = Annotated[str, Field(pattern=r"^[A-Z]{3}-\d{4}$")]`
---rule
sku\s*:\s*Sku\b
`sku: Sku`
---solution
from typing import Annotated

from pydantic import BaseModel, Field

Sku = Annotated[str, Field(pattern=r"^[A-Z]{3}-\d{4}$")]


class Product(BaseModel):
    sku: Sku
    name: str
:::

:::exercise
id: pv-predict-strict
level: 2
title: Predict: coercion
mode: answer
---
```python
class Item(BaseModel):
    qty: int

print(Item.model_validate({"qty": "7"}).qty + 1)
```

What does it print?
---answer
8
---solution
8
---explain
In the default lax mode Pydantic converts the numeric string `"7"` to the int `7`. With `strict=True` it would raise a validation error instead.
:::

:::exercise
id: pv-predict-forbid
level: 2
title: Predict: extra keys
mode: answer
---
A FastAPI route takes `body: UserUpdate` where `UserUpdate` has `model_config = ConfigDict(extra="forbid")` and one optional field `bio`. A client sends `{"bio": "hi", "admin": true}`. What status code comes back?
---answer
422
---solution
422
:::

:::exercise
id: proj-fa-11-tags
level: 2
title: "Project 12: normalize tags"
mode: code
lang: python
file: models.py
path: app/models.py
---
Add a field validator for `tags` that returns the tags **trimmed, lowercased, de-duplicated and sorted**, dropping empty strings: `sorted({t.strip().lower() for t in v if t.strip()})`.
---starter
from pydantic import BaseModel, Field, field_validator


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    tags: list[str] = []
---rule
@field_validator\(\s*["']tags["']\s*\)\s*\n\s*@classmethod
`@field_validator("tags")` + `@classmethod`
---rule
def\s+\w+\(\s*cls\s*,\s*(v|value)\b
Takes `cls, v`
---rule
sorted\(\s*\{\s*\w+\.strip\(\s*\)\.lower\(\s*\)\s+for\s+\w+\s+in\s+(v|value)\s+if\s+\w+\.strip\(\s*\)\s*\}\s*\)
`sorted({t.strip().lower() for t in v if t.strip()})`
---rule
return\s+sorted\(
Return the cleaned list
---solution
from pydantic import BaseModel, Field, field_validator


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    tags: list[str] = []

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, v: list[str]) -> list[str]:
        return sorted({t.strip().lower() for t in v if t.strip()})
:::

:::exercise
id: proj-fa-11-done-note
level: 3
title: "Project 12b: done needs a note"
mode: code
lang: python
file: models.py
path: app/models.py
---
Add an after-mode model validator to `TaskUpdate` that raises `ValueError("completion_note is required when status is done")` when `self.status == "done"` and `self.completion_note` is falsy. Return `self`.
---starter
from typing import Self

from pydantic import BaseModel, model_validator


class TaskUpdate(BaseModel):
    status: str | None = None
    completion_note: str | None = None
---rule
@model_validator\(\s*mode\s*=\s*["']after["']\s*\)
`@model_validator(mode="after")`
---rule
def\s+\w+\(\s*self\s*\)
Takes `self`
---rule
self\.status\s*==\s*["']done["']\s+and\s+not\s+self\.completion_note
`status == "done" and not completion_note`
---rule
raise\s+ValueError\(\s*["']completion_note is required when status is done["']\s*\)
Raise the message
---rule
return\s+self
Return `self`
---solution
from typing import Self

from pydantic import BaseModel, model_validator


class TaskUpdate(BaseModel):
    status: str | None = None
    completion_note: str | None = None

    @model_validator(mode="after")
    def note_when_done(self) -> Self:
        if self.status == "done" and not self.completion_note:
            raise ValueError("completion_note is required when status is done")
        return self
:::
