#!/usr/bin/env python3
"""Disposable stdlib regression: python3 scripts/check-monitoring-repair.py."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

MODULE = Path(__file__).with_name('repair-monitoring-history.py')
spec = importlib.util.spec_from_file_location('repair', MODULE)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    scratch = Path(os.environ.get('TMPDIR', '/root/.hermes/cache/scratch'))
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='monitor-repair-check-', dir=scratch) as directory:
        root = Path(directory)
        source, allow = root / 'source.db', root / 'allow.json'
        obsolete, never, stopped, current, remote, app = [c * 64 for c in 'abcdef']
        identities = (obsolete, never, stopped)
        allow.write_text(json.dumps({'version': 1, 'targets': [
            {'identity': i, 'serverId': 'local', 'appId': None, 'obsolete': True}
            for i in identities]}))
        db = sqlite3.connect(source)
        db.execute('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)')
        db.execute('CREATE TABLE business(id INTEGER PRIMARY KEY,secret BLOB)')
        db.execute('CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER REFERENCES business(id),payload TEXT)')
        db.execute('INSERT INTO business VALUES(1,?)', (b'private\x00bytes',))
        db.execute('INSERT INTO audit VALUES(1,1,?)', ('private audit',))
        expected_delete = set()

        def point(identity, minute, kind='unavailable', change=None, delete=False):
            time = (dt.datetime(2026, 1, 1) + dt.timedelta(minutes=minute)).isoformat(timespec='milliseconds') + 'Z'
            key = repair.PREFIX + time + ':' + identity
            value = dict(time=time, cpu=None, mem=None, netIn=None, netOut=None)
            if kind == 'numeric':
                value.update(cpu=0, mem=1.5, netIn=2, netOut=3)
            else:
                value['gap'] = kind
            if change:
                change(value)
            db.execute('INSERT INTO app_settings VALUES(?,?,?)', (key, json.dumps(value), 'unchanged'))
            if delete:
                expected_delete.add(key)
            return key

        point(obsolete, 0, 'numeric')
        point(obsolete, 1)  # Internal gaps must survive.
        point(obsolete, 2)
        point(obsolete, 3, 'numeric')
        point(obsolete, 4, 'stopped')
        point(obsolete, 5)  # First tail gap survives.
        point(obsolete, 6, delete=True)
        point(never, 0)  # Unknown original disappearance: keep earliest gap.
        point(never, 1, delete=True)
        point(stopped, 0)
        point(stopped, 1, 'stopped')
        point(stopped, 2)
        point(stopped, 3, delete=True)
        for identity in (current, remote, app):
            for minute in range(4):
                point(identity, minute)
        for minute, change in enumerate((
            lambda p: p.update(cpu='0'), lambda p: p.update(cpu=True),
            lambda p: p.update(cpu=-1), lambda p: p.update(cpu=float('nan')),
            lambda p: p.update(time='bad'), lambda p: p.update(extra=1),
            lambda p: p.pop('mem'), lambda p: p.update(gap='future'),
            lambda p: p.update(gap='missing'), lambda p: p.pop('gap'),
            lambda p: p.update(cpu=1),  # Numeric plus gap is ambiguous.
        ), 10):
            point(obsolete, minute, change=change)
        point(obsolete, 25, 'numeric', change=lambda p: p.update(mem=None))  # Partial reading is reliable.
        # The new reliable sample makes earlier unavailable gaps internal.
        expected_delete = {key for key in expected_delete if not key.endswith(obsolete)}
        point(obsolete, 26)
        point(obsolete, 27, delete=True)
        for minute, value in ((28, '{'), (29, 'null'), (30, '{"time":1,"time":2}')):
            time = f'2026-01-01T00:{minute:02}:00.000Z'
            db.execute('INSERT INTO app_settings VALUES(?,?,?)', (repair.PREFIX + time + ':' + obsolete, value, 'unchanged'))
        for bad in ('2026-02-30T00:00:00.000Z', '2026-01-01T00:00:00Z', 'not-time'):
            db.execute('INSERT INTO app_settings VALUES(?,?,?)', (repair.PREFIX + bad + ':' + obsolete, '{}', 'unchanged'))
        db.execute('INSERT INTO app_settings VALUES(?,?,?)', ('secret:token', 'do-not-print-me', 'unchanged'))
        db.execute('INSERT INTO app_settings VALUES(?,?,?)', ('monitoring:v1:target:' + current, '{"serverId":"local"}', 'unchanged'))
        # Force >1000 deletion candidates and real freelist/compaction shrink.
        for minute in range(31, 12031):
            point(never, minute, delete=True)
        db.commit()
        original_rows = dict((r[0], r) for r in db.execute('SELECT * FROM app_settings'))
        # Assert keyset query uses the unique index, never a per-target scan.
        plan = str(db.execute('EXPLAIN QUERY PLAN SELECT * FROM app_settings WHERE key COLLATE BINARY > ? ORDER BY key COLLATE BINARY LIMIT 1000', ('x',)).fetchall())
        assert 'SEARCH' in plan and 'INDEX' in plan, plan
        db.close()
        source_hash = sha(source)
        dry = repair.repair(source, allow, root / 'dry.jsonl')
        clone, compact = root / 'clone.db', root / 'compact.db'
        applied = repair.repair(source, allow, root / 'apply.jsonl', clone, compact)
        assert dry['candidates'] == applied['candidates'] == len(expected_delete)
        assert dry['candidate_rows_sha256'] == applied['candidate_rows_sha256']
        assert dry['protected_settings_sha256'] == applied['protected_settings_sha256']
        for path in (clone, compact):
            conn = sqlite3.connect(path)
            actual_rows = dict((r[0], r) for r in conn.execute('SELECT * FROM app_settings'))
            assert set(original_rows) - set(actual_rows) == expected_delete
            assert actual_rows == {k: v for k, v in original_rows.items() if k not in expected_delete}
            assert conn.execute('SELECT * FROM business').fetchall() == [(1, b'private\x00bytes')]
            assert conn.execute('SELECT * FROM audit').fetchall() == [(1, 1, 'private audit')]
            assert conn.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
            assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
            conn.close()
        assert sha(source) == source_hash
        assert compact.stat().st_size < clone.stat().st_size // 2
        records = [json.loads(line) for line in (root / 'apply.jsonl').read_text().splitlines()]
        intents = [r for r in records if r['event'] == 'batch_intent']
        assert max(r['count'] for r in intents) <= 1000
        assert sum(r['count'] for r in intents) == len(expected_delete)
        assert records[-1]['event'] == 'complete'
        assert 'do-not-print-me' not in (root / 'apply.jsonl').read_text()
        # Idempotence and real CLI dry-run.
        rerun = repair.repair(compact, allow, root / 'rerun.jsonl')
        assert rerun['candidates'] == 0
        cli = subprocess.run([sys.executable, str(MODULE), str(source), '--allowlist', str(allow), '--report', str(root / 'cli.jsonl')], capture_output=True, text=True)
        assert cli.returncode == 0, cli.stderr
        assert json.loads(cli.stdout)['candidates'] == len(expected_delete)
        for badpath in ('/var/lib/docker/test.db', '/opt/vps-panel/data/test.db'):
            try:
                repair.safe_path(badpath)
                raise AssertionError('production path accepted')
            except ValueError:
                pass
        for invalid in (
            {'identity': obsolete, 'serverId': 'remote', 'appId': None, 'obsolete': True},
            {'identity': obsolete, 'serverId': 'local', 'appId': 'app', 'obsolete': True},
            {'identity': obsolete, 'serverId': 'local', 'appId': None, 'obsolete': False},
            {'identity': 'bad', 'serverId': 'local', 'appId': None, 'obsolete': True},
        ):
            bad = root / 'bad.json'
            bad.write_text(json.dumps({'version': 1, 'targets': [invalid]}))
            try:
                repair.load_allowlist(bad)
                raise AssertionError('bad allowlist accepted')
            except ValueError:
                pass
        try:
            repair.repair(source, allow, root / 'refused.jsonl', source)
            raise AssertionError('source overwrite accepted')
        except ValueError:
            pass
        assert sha(source) == source_hash
        # Trigger side effects must roll back the entire clone repair.
        trap = root / 'trap.db'
        conn = sqlite3.connect(trap)
        src = sqlite3.connect(source)
        src.backup(conn)
        src.close()
        conn.execute("CREATE TRIGGER destructive AFTER DELETE ON app_settings BEGIN UPDATE business SET secret='changed'; END")
        conn.commit()
        conn.close()
        try:
            repair.repair(trap, allow, root / 'trap.jsonl', root / 'trap-clone.db')
            raise AssertionError('side effect accepted')
        except ValueError:
            pass
        conn = sqlite3.connect(root / 'trap-clone.db')
        assert conn.execute('SELECT count(*) FROM app_settings').fetchone()[0] == len(original_rows)
        assert conn.execute('SELECT secret FROM business').fetchone()[0] == b'private\x00bytes'
        conn.close()
        print(json.dumps({'status': 'PASS', 'candidates': len(expected_delete),
                          'delete_batches': len(intents), 'source_unchanged': True,
                          'protected_rows_exact': True, 'rollback_verified': True,
                          'clone_bytes': applied['clone_bytes'], 'compact_bytes': applied['compact_bytes'],
                          'checks': ['mixed metrics/stopped/internal/tail', 'never-observed first gap',
                                     'malformed retained', 'current/Remote/App retained',
                                     'business/secrets/audit retained', 'indexed keyset/batch limit',
                                     'integrity/FK', 'CLI/idempotence/path/allowlist guards', 'compaction shrink']}))


if __name__ == '__main__':
    main()
