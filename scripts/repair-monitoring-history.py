#!/usr/bin/env python3
"""Offline, allowlisted history repair. Never edits the input database.

Input JSON: {"version":1,"targets":[{"identity":"<64 lowercase hex>",
"serverId":"local","appId":null,"obsolete":true}]}.
The operator must freeze this list AFTER the corrected collector retires targets;
this tool cannot infer retirement from old samples. No-observation histories keep
one first unavailable marker: the original disappearance time is unknowable.

Dry run: SOURCE --allowlist FILE --report NEW.jsonl
Apply: same arguments plus --apply NEW_CLONE [--compact NEW_COMPACT]
Only the new clone is modified. Parent/operator owns offline replacement.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3

BATCH = 1000
PREFIX = 'monitoring:v1:sample:'
IDENTITY = re.compile(r'[0-9a-f]{64}')
TIME = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z')
METRICS = {'cpu', 'mem', 'netIn', 'netOut'}


def digest_row(h, row):
    # Length framing and type tags avoid ambiguities and preserve SQLite values.
    for value in row:
        if isinstance(value, bytes):
            encoded = b'b' + base64.b64encode(value)
        else:
            encoded = (type(value).__name__ + ':' + repr(value)).encode('utf-8')
        h.update(len(encoded).to_bytes(8, 'big'))
        h.update(encoded)


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON field')
        result[key] = value
    return result


def parse_json(text):
    return json.loads(text, object_pairs_hook=strict_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def load_allowlist(path):
    raw = path.read_bytes()
    value = parse_json(raw)
    if not isinstance(value, dict) or set(value) != {'version', 'targets'} or type(value['version']) is not int or value['version'] != 1 or not isinstance(value['targets'], list):
        raise ValueError('invalid allowlist envelope')
    identities = set()
    for target in value['targets']:
        if not isinstance(target, dict) or set(target) != {'identity', 'serverId', 'appId', 'obsolete'}:
            raise ValueError('invalid allowlist target fields')
        identity = target['identity']
        if not isinstance(identity, str) or not IDENTITY.fullmatch(identity) or target['serverId'] != 'local' or target['appId'] is not None or target['obsolete'] is not True or identity in identities:
            raise ValueError('allowlist must contain unique obsolete local non-App identities only')
        identities.add(identity)
    return identities, hashlib.sha256(raw).hexdigest()


def classify(key, value, identities):
    if not isinstance(key, str) or not key.startswith(PREFIX):
        return None
    time, separator, identity = key[len(PREFIX):].rpartition(':')
    if not separator or identity not in identities or not TIME.fullmatch(time):
        return None
    try:
        dt.datetime.strptime(time, '%Y-%m-%dT%H:%M:%S.%fZ')
        point = parse_json(value)
        if not isinstance(point, dict) or set(point) not in ({'time'} | METRICS, {'time', 'gap'} | METRICS) or point['time'] != time:
            return None
        metrics = [point[name] for name in sorted(METRICS)]
        if not all(v is None or (type(v) in (int, float) and math.isfinite(v) and v >= 0) for v in metrics):
            return None
        if all(v is None for v in metrics):
            kind = point.get('gap')
            return (identity, time, kind) if kind in ('unavailable', 'stopped') else None
        if 'gap' not in point:
            return identity, time, 'observed'
    except (ValueError, TypeError, OverflowError, RecursionError):
        pass
    return None


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def settings_batches(db):
    cursor_key = None
    while True:
        if cursor_key is None:
            rows = db.execute('SELECT * FROM app_settings ORDER BY key COLLATE BINARY LIMIT ?', (BATCH,)).fetchall()
        else:
            rows = db.execute('SELECT * FROM app_settings WHERE key COLLATE BINARY > ? ORDER BY key COLLATE BINARY LIMIT ?', (cursor_key, BATCH)).fetchall()
        if not rows:
            return
        yield rows
        cursor_key = rows[-1]['key']


def boundaries(db, identities):
    state = {identity: [None, None] for identity in identities}
    count = 0
    for rows in settings_batches(db):
        for row in rows:
            count += 1
            parsed = classify(row['key'], row['value'], identities)
            if parsed:
                identity, time, kind = parsed
                if kind in ('observed', 'stopped'):
                    state[identity] = [time, None]
                elif state[identity][1] is None:
                    state[identity][1] = row['key']
    return state, count


def candidate(row, identities, state):
    parsed = classify(row['key'], row['value'], identities)
    if not parsed or parsed[2] != 'unavailable':
        return False
    last, first = state[parsed[0]]
    return (last is None or parsed[1] > last) and row['key'] != first


def other_fingerprint(db):
    h = hashlib.sha256()
    objects = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").fetchall()
    for row in objects:
        digest_row(h, row)
    for row in objects:
        kind, name, _, sql = row
        if kind != 'table' or name == 'app_settings':
            continue
        digest_row(h, (name,))
        columns = db.execute('PRAGMA table_info(' + quote(name) + ')').fetchall()
        primary = [r['name'] for r in sorted(columns, key=lambda r: r['pk']) if r['pk']]
        order = ','.join(quote(c) for c in primary) if primary else 'rowid'
        cursor = db.execute('SELECT * FROM ' + quote(name) + ' ORDER BY ' + order)
        while True:
            rows = cursor.fetchmany(BATCH)
            if not rows:
                break
            for record in rows:
                digest_row(h, record)
    return h.hexdigest()


def checks(db):
    if [r[0] for r in db.execute('PRAGMA integrity_check')] != ['ok']:
        raise ValueError('integrity check failed')
    if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise ValueError('foreign key check failed')


def safe_path(path):
    path = Path(path).resolve()
    for root in ('/var/lib/docker', '/opt/vps-panel'):
        if path == Path(root) or Path(root) in path.parents:
            raise ValueError('active/production location rejected')
    return path


def reserve(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)


def repair(source, allowlist, report, apply=None, compact=None):
    source, report = safe_path(source), safe_path(report)
    apply = safe_path(apply) if apply else None
    compact = safe_path(compact) if compact else None
    if compact and not apply:
        raise ValueError('compact requires --apply NEW_CLONE')
    paths = [source, Path(allowlist).resolve(), report] + ([apply] if apply else []) + ([compact] if compact else [])
    if len(set(paths)) != len(paths):
        raise ValueError('input/output paths must differ')
    # Never overwrite existing outputs, including symlinks/hardlinks to backups.
    for path in (report, apply, compact):
        if path and path.exists():
            raise ValueError('output already exists')
    identities, allow_hash = load_allowlist(Path(allowlist))
    reserve(report)
    with report.open('a', encoding='utf-8') as log:
        def event(**data):
            log.write(json.dumps(data, sort_keys=True) + '\n')
            log.flush()
            os.fsync(log.fileno())
        event(event='start', mode='apply' if apply else 'dry-run', allowlist_sha256=allow_hash,
              identities=len(identities), batch_limit=BATCH,
              rule='keep first trailing unavailable, including never-observed identities')
        db = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        clone = None
        try:
            if apply:
                reserve(apply)
                clone = sqlite3.connect(apply)
                db.backup(clone)
                db.close()
                db = clone
                db.row_factory = sqlite3.Row
                db.execute('PRAGMA foreign_keys=ON')
                db.execute('PRAGMA synchronous=FULL')
                db.execute('BEGIN IMMEDIATE')
            else:
                db.execute('BEGIN')
            checks(db)
            columns = db.execute('PRAGMA table_info(app_settings)').fetchall()
            if [r['name'] for r in columns if r['pk']] != ['key'] or not any(r['name'] == 'value' for r in columns):
                raise ValueError('expected app_settings primary key/value schema')
            state, scanned = boundaries(db, identities)
            event(event='boundaries', scanned=scanned,
                  never_observed=sum(last is None for last, _ in state.values()))
            other_before = other_fingerprint(db)
            protected = hashlib.sha256()
            removed = hashlib.sha256()
            deleted = 0
            for rows in settings_batches(db):
                batch = []
                for row in rows:
                    if candidate(row, identities, state):
                        batch.append((row['key'], row['value']))
                        digest_row(removed, row)
                    else:
                        digest_row(protected, row)
                if batch:
                    batch_hash = hashlib.sha256()
                    for pair in batch:
                        digest_row(batch_hash, pair)
                    event(event='batch_intent', count=len(batch), cumulative=deleted + len(batch),
                          key_value_sha256=batch_hash.hexdigest())
                    if apply:
                        before = db.total_changes
                        db.executemany('DELETE FROM app_settings WHERE key COLLATE BINARY = ? AND value IS ?', batch)
                        if db.total_changes - before != len(batch):
                            raise ValueError('exact delete count mismatch (including trigger changes)')
                    deleted += len(batch)
                    event(event='batch_checked', cumulative=deleted)
            if apply:
                after = hashlib.sha256()
                remaining = 0
                for rows in settings_batches(db):
                    for row in rows:
                        remaining += 1
                        digest_row(after, row)
                if after.digest() != protected.digest() or remaining != scanned - deleted or other_fingerprint(db) != other_before:
                    raise ValueError('protected data fingerprint/count mismatch')
                checks(db)
                db.commit()
                event(event='committed', deleted=deleted)
            else:
                db.rollback()
            result = dict(event='complete', candidates=deleted, scanned=scanned,
                          retained=scanned-deleted, allowlist_sha256=allow_hash,
                          candidate_rows_sha256=removed.hexdigest(),
                          protected_settings_sha256=protected.hexdigest(),
                          protected_other_sha256=other_before, integrity='ok', foreign_keys='ok')
            if compact:
                # SQLite accepts an existing EMPTY file: reserve private permissions
                # before writing any secrets, and fsync VACUUM INTO explicitly.
                reserve(compact)
                db.execute('VACUUM INTO ?', (str(compact),))
                with compact.open('rb') as output:
                    os.fsync(output.fileno())
                verify = sqlite3.connect(compact)
                verify.row_factory = sqlite3.Row
                try:
                    checks(verify)
                    h = hashlib.sha256()
                    for rows in settings_batches(verify):
                        for row in rows:
                            digest_row(h, row)
                    if h.digest() != protected.digest() or other_fingerprint(verify) != other_before:
                        raise ValueError('compact fingerprint mismatch')
                finally:
                    verify.close()
                result.update(clone_bytes=apply.stat().st_size, compact_bytes=compact.stat().st_size)
            for directory in {p.parent for p in (report, apply, compact) if p}:
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            event(**result)
            return result
        except Exception:
            db.rollback()
            event(event='failed', committed=False if db.in_transaction else 'inspect committed checkpoint')
            raise
        finally:
            db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source', type=Path)
    parser.add_argument('--allowlist', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--apply', type=Path, metavar='NEW_CLONE')
    parser.add_argument('--compact', type=Path, metavar='NEW_COMPACT')
    args = parser.parse_args()
    try:
        print(json.dumps(repair(**vars(args)), sort_keys=True))
    except (ValueError, OSError, sqlite3.Error) as error:
        # Do not echo SQLite error text: it can contain private values/DDL.
        parser.exit(1, 'repair failed (' + type(error).__name__ + '); inspect report checkpoints\n')


if __name__ == '__main__':
    main()
