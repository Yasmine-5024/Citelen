import sqlite3
import os
import json
import secrets
import hashlib
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'users.db')
SECRET_KEY = os.environ.get('JWT_SECRET', 'reflens-dev-secret-change-in-prod')


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            institution TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS user_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pdf_hash TEXT NOT NULL,
            paper_title TEXT DEFAULT '',
            paper_authors TEXT DEFAULT '[]',
            uploaded_at TEXT DEFAULT (datetime('now')),
            last_accessed TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, pdf_hash),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pdf_hash TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, pdf_hash),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pdf_hash TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, pdf_hash),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    ''')
    conn.commit()
    conn.close()


# ── Password hashing (PBKDF2, no extra deps) ─────────────────────────────────

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200_000)
    return f"pbkdf2:{salt}:{h.hex()}"


def _check_password(password: str, stored: str) -> bool:
    try:
        _, salt, stored_hash = stored.split(':', 2)
        h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200_000)
        return h.hex() == stored_hash
    except Exception:
        return False


# ── JWT-style tokens (simple HMAC, no extra deps) ────────────────────────────

def make_token(user_id: int) -> str:
    import base64, hmac
    exp = (datetime.utcnow() + timedelta(days=30)).timestamp()
    payload = json.dumps({'user_id': user_id, 'exp': exp})
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|||{sig}".encode()).decode()


def verify_token(token: str) -> int:
    import base64, hmac
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        payload_str, sig = decoded.rsplit('|||', 1)
        expected = hmac.new(SECRET_KEY.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError('Invalid signature')
        payload = json.loads(payload_str)
        if payload['exp'] < datetime.utcnow().timestamp():
            raise ValueError('Token expired')
        return int(payload['user_id'])
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f'Invalid token: {e}')


# ── User CRUD ────────────────────────────────────────────────────────────────

def register_user(email: str, name: str, password: str, institution: str = '') -> dict:
    conn = get_conn()
    try:
        pw_hash = _hash_password(password)
        conn.execute(
            'INSERT INTO users (email, name, password_hash, institution) VALUES (?, ?, ?, ?)',
            (email.lower().strip(), name.strip(), pw_hash, institution.strip()),
        )
        conn.commit()
        row = conn.execute(
            'SELECT id, email, name, institution, created_at FROM users WHERE email = ?',
            (email.lower().strip(),),
        ).fetchone()
        return dict(row)
    except sqlite3.IntegrityError:
        raise ValueError('Email already registered')
    finally:
        conn.close()


def login_user(email: str, password: str) -> dict:
    conn = get_conn()
    try:
        row = conn.execute('SELECT * FROM users WHERE email = ?', (email.lower().strip(),)).fetchone()
        if not row or not _check_password(password, row['password_hash']):
            raise ValueError('Invalid email or password')
        return {'id': row['id'], 'email': row['email'], 'name': row['name'],
                'institution': row['institution'], 'created_at': row['created_at']}
    finally:
        conn.close()


def get_user(user_id: int) -> dict | None:
    conn = get_conn()
    try:
        row = conn.execute(
            'SELECT id, email, name, institution, created_at FROM users WHERE id = ?', (user_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── Review history ────────────────────────────────────────────────────────────

def save_review_history(user_id: int, pdf_hash: str, paper_title: str, paper_authors: list):
    conn = get_conn()
    try:
        conn.execute('''
            INSERT INTO user_reviews (user_id, pdf_hash, paper_title, paper_authors)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, pdf_hash) DO UPDATE SET
                paper_title = excluded.paper_title,
                paper_authors = excluded.paper_authors,
                last_accessed = datetime('now')
        ''', (user_id, pdf_hash, paper_title, json.dumps(paper_authors)))
        conn.commit()
    finally:
        conn.close()


def get_review_history(user_id: int) -> list:
    conn = get_conn()
    try:
        rows = conn.execute(
            '''SELECT pdf_hash, paper_title, paper_authors, uploaded_at, last_accessed
               FROM user_reviews WHERE user_id = ? ORDER BY last_accessed DESC''',
            (user_id,),
        ).fetchall()
        result = []
        for row in rows:
            r = dict(row)
            try:
                r['paper_authors'] = json.loads(r['paper_authors'])
            except Exception:
                r['paper_authors'] = []
            result.append(r)
        return result
    finally:
        conn.close()


# ── Draft ─────────────────────────────────────────────────────────────────────

def save_draft(user_id: int, pdf_hash: str, content: str):
    conn = get_conn()
    try:
        conn.execute('''
            INSERT INTO drafts (user_id, pdf_hash, content)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, pdf_hash) DO UPDATE SET
                content = excluded.content,
                updated_at = datetime('now')
        ''', (user_id, pdf_hash, content))
        conn.commit()
    finally:
        conn.close()


def get_draft(user_id: int, pdf_hash: str) -> dict | None:
    conn = get_conn()
    try:
        row = conn.execute(
            'SELECT content, updated_at FROM drafts WHERE user_id = ? AND pdf_hash = ?',
            (user_id, pdf_hash),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── Chat sessions ─────────────────────────────────────────────────────────────

def save_chat(user_id: int, pdf_hash: str, messages: list):
    conn = get_conn()
    try:
        conn.execute('''
            INSERT INTO chat_sessions (user_id, pdf_hash, messages)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, pdf_hash) DO UPDATE SET
                messages = excluded.messages,
                updated_at = datetime('now')
        ''', (user_id, pdf_hash, json.dumps(messages)))
        conn.commit()
    finally:
        conn.close()


def get_chat(user_id: int, pdf_hash: str) -> list:
    conn = get_conn()
    try:
        row = conn.execute(
            'SELECT messages FROM chat_sessions WHERE user_id = ? AND pdf_hash = ?',
            (user_id, pdf_hash),
        ).fetchone()
        return json.loads(row['messages']) if row else []
    finally:
        conn.close()
