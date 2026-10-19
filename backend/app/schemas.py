import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class CreateEventIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    date: dt.date
    schedule_text: str = Field(default="", max_length=20000)
    timezone: str | None = Field(default=None, max_length=64)


class CreateEventOut(BaseModel):
    event_id: int
    code: str
    code_expires_at: float
    admin_password: str
    admin_token: str


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=100)


class LoginOut(BaseModel):
    admin_token: str
    event_id: int
    event_name: str


class JoinIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")
    name: str = Field(default="", max_length=100)


class EventBrief(BaseModel):
    id: int
    name: str
    date: dt.date


class JoinOut(BaseModel):
    device_token: str
    device_id: int
    event: EventBrief


class DeviceMe(BaseModel):
    device_id: int
    name: str
    event: EventBrief


class EventInfo(BaseModel):
    id: int
    name: str
    date: dt.date
    code: str
    code_expires_at: float
    code_expired: bool
    created_at: float
    timezone: str


class EventPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    date: dt.date | None = None
    timezone: str | None = Field(default=None, max_length=64)


class BreakItem(BaseModel):
    start: str = Field(pattern=r"^\d{1,2}:\d{2}$")
    end: str = Field(pattern=r"^\d{1,2}:\d{2}$")


class ScheduleIn(BaseModel):
    breaks: list[BreakItem] = Field(max_length=200)


class ScheduleOut(BaseModel):
    breaks: list[BreakItem]


class TrackPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    artist: str | None = Field(default=None, max_length=300)
    loop: bool | None = None
    enabled: bool | None = None


class TrackOrder(BaseModel):
    ids: list[int]


class PlayerPatch(BaseModel):
    mode: Literal["auto", "on", "off"] | None = None
    repeat_mode: Literal["all", "one", "off"] | None = None


class JumpIn(BaseModel):
    track_id: int


class SeekIn(BaseModel):
    position: float = Field(ge=0)


class MoveNextIn(BaseModel):
    track_id: int
