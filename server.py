"""FastAPI server for the prac site and its accounts."""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

import pymysql
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
SESSION_AGE = 30 * 24 * 60 * 60

def connect():
    return pymysql.connect(host=os.getenv('MYSQL_HOST', '127.0.0.1'), port=int(os.getenv('MYSQL_PORT', '3306')),
                           user=os.getenv('MYSQL_USER', 'prac'), password=os.getenv('MYSQL_PASSWORD', 'prac'),
                           database=os.getenv('MYSQL_DATABASE', 'prac'), charset='utf8mb4', autocommit=True)

@asynccontextmanager
async def lifespan(app):
    with connect() as db, db.cursor() as cursor:
        cursor.execute('''CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
            salt BINARY(16) NOT NULL, password_hash BINARY(64) NOT NULL)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS sessions (token_hash BINARY(32) PRIMARY KEY,
            user_id BIGINT NOT NULL, expires BIGINT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS account_data (user_id BIGINT NOT NULL,
            data_key VARCHAR(32) CHARACTER SET ascii NOT NULL, data_value LONGTEXT NOT NULL,
            PRIMARY KEY (user_id, data_key), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)''')
    yield

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

class Credentials(BaseModel):
    username: str
    password: str
    confirmPassword: str | None = None

def password_hash(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1)

def check_origin(request):
    origin = request.headers.get('origin')
    host = request.headers.get('host', '')
    if origin and origin not in ('http://' + host, 'https://' + host):
        raise HTTPException(403, 'Request origin is not allowed.')

def token_hash(token):
    return hashlib.sha256(token.encode()).digest()

def set_session(response, token):
    response.set_cookie('prac_session', token, max_age=SESSION_AGE, httponly=True, samesite='lax',
                        secure=os.getenv('PRAC_SECURE_COOKIE') == '1', path='/')

@app.get('/api/session')
def session(request: Request):
    token = request.cookies.get('prac_session', '')
    with connect() as db, db.cursor() as cursor:
        cursor.execute('SELECT users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = %s AND expires > %s', (token_hash(token), int(time.time())))
        user = cursor.fetchone()
    return {'username': user[0] if user else None}


class AccountData(BaseModel):
    value: dict

def current_user_id(request):
    with connect() as db, db.cursor() as cursor:
        cursor.execute('SELECT user_id FROM sessions WHERE token_hash = %s AND expires > %s',
                       (token_hash(request.cookies.get('prac_session', '')), int(time.time())))
        user = cursor.fetchone()
    if not user:
        raise HTTPException(401, 'Please sign in.')
    return user[0]

@app.get('/api/data')
def get_account_data(request: Request):
    user_id = current_user_id(request)
    with connect() as db, db.cursor() as cursor:
        cursor.execute('SELECT data_key, data_value FROM account_data WHERE user_id = %s', (user_id,))
        return {key: json.loads(value) for key, value in cursor.fetchall()}

@app.put('/api/data/{key}')
def save_account_data(key: str, data: AccountData, request: Request):
    check_origin(request)
    if key not in ('progress', 'drafts', 'project'):
        raise HTTPException(404, 'Not found.')
    value = json.dumps(data.value, ensure_ascii=False)
    if len(value.encode('utf-8')) > 2_000_000:
        raise HTTPException(413, 'Saved data is too large.')
    user_id = current_user_id(request)
    with connect() as db, db.cursor() as cursor:
        cursor.execute('INSERT INTO account_data (user_id, data_key, data_value) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE data_value = %s',
                       (user_id, key, value, value))
    return {'ok': True}

@app.post('/api/{action}')
def authenticate(action: str, request: Request, response: Response, data: Credentials):
    check_origin(request)
    if action not in ('signup', 'signin'):
        raise HTTPException(404, 'Not found.')
    username, password = data.username, data.password
    if not re.fullmatch(r'[A-Za-z0-9_]{3,32}', username):
        raise HTTPException(400, 'Username must be 3–32 letters, numbers, or underscores.')
    if len(password) < 8 or len(password.encode('utf-8')) > 1024:
        raise HTTPException(400, 'Password must be at least 8 characters and at most 1024 bytes.')
    with connect() as db, db.cursor() as cursor:
        if action == 'signup':
            if password != data.confirmPassword:
                raise HTTPException(400, 'Passwords do not match.')
            salt = secrets.token_bytes(16)
            try:
                cursor.execute('INSERT INTO users (username, salt, password_hash) VALUES (%s, %s, %s)', (username, salt, password_hash(password, salt)))
            except pymysql.err.IntegrityError:
                raise HTTPException(409, 'That username is already taken.')
            user_id = cursor.lastrowid
        else:
            cursor.execute('SELECT id, username, salt, password_hash FROM users WHERE username = %s', (username,))
            user = cursor.fetchone()
            candidate = password_hash(password, user[2] if user else bytes(16))
            if not user or not hmac.compare_digest(candidate, user[3]):
                raise HTTPException(401, 'Incorrect username or password.')
            user_id, username = user[0], user[1]
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        cursor.execute('DELETE FROM sessions WHERE expires <= %s', (now,))
        cursor.execute('INSERT INTO sessions VALUES (%s, %s, %s)', (token_hash(token), user_id, now + SESSION_AGE))
    set_session(response, token)
    return {'username': username}

@app.post('/api/signout')
def signout(request: Request, response: Response):
    check_origin(request)
    if request.headers.get('content-type', '').split(';')[0] != 'application/json':
        raise HTTPException(415, 'Expected JSON.')
    with connect() as db, db.cursor() as cursor:
        cursor.execute('DELETE FROM sessions WHERE token_hash = %s', (token_hash(request.cookies.get('prac_session', '')),))
    response.delete_cookie('prac_session', path='/', httponly=True, samesite='lax', secure=os.getenv('PRAC_SECURE_COOKIE') == '1')
    return {'ok': True}

# Register signout before the parameterized route so it is not treated as credentials.
app.router.routes.sort(key=lambda route: getattr(route, 'path', '') == '/api/{action}')
app.mount('/', StaticFiles(directory=ROOT / 'site', html=True), name='site')
