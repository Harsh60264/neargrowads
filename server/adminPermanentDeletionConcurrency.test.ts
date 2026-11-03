import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const databaseUrl = process.env.ADMIN_PERMANENT_DELETION_TEST_DATABASE_URL;
const psqlPath = process.env.PSQL_BIN || 'psql';

function startPsql(sql: string): {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  output: Promise<string>;
} {
  const child = spawn(psqlPath, [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-A',
    '-t',
    '-d',
    databaseUrl!,
  ]);
  let stdout = '';
  let stderr = '';
  let signalReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let didSignalReady = false;
  const ready = new Promise<void>((resolve, reject) => {
    signalReady = resolve;
    rejectReady = reject;
  });
  const output = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!didSignalReady && stdout.includes('LOCK_HELD')) {
        didSignalReady = true;
        signalReady?.();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      rejectReady?.(error);
      reject(error);
    });
    child.on('close', (code) => {
      if (!didSignalReady) rejectReady?.(new Error(stderr || stdout || 'psql exited before acquiring the deletion lock'));
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `psql exited with status ${code}`));
    });
  });
  child.stdin.end(sql);
  return { child, ready, output };
}

test('concurrent deletion requests serialize and retain one pending job', {
  skip: !databaseUrl,
}, async () => {
  const actorId = randomUUID();
  const targetId = randomUUID();
  const actorEmail = `${actorId}@example.test`;
  const targetEmail = `${targetId}@example.test`;
  const guardedDatabase = await new Promise<string>((resolve, reject) => {
    const child = spawn(psqlPath, ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-d', databaseUrl!]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `psql exited with status ${code}`));
      else resolve(stdout.trim());
    });
    child.stdin.end('select current_database();');
  });
  assert.match(guardedDatabase, /^admin_delete_test_/,
    'concurrency tests must use an isolated admin_delete_test_* database');

  const fixture = [
    `insert into auth.users (id,email) values ('${actorId}','${actorEmail}'),('${targetId}','${targetEmail}');`,
    `insert into public.admin_users (id,email,role,status,is_primary_owner,archived_at) values ('${actorId}','${actorEmail}','owner','active',true,null),('${targetId}','${targetEmail}','custom_admin','disabled',false,clock_timestamp());`,
  ].join('\n');
  await runPsql(fixture);

  const first = startPsql([
    'begin;',
    `select public.begin_admin_permanent_deletion('${actorId}','${targetId}','${targetEmail}','DELETE');`,
    "select 'LOCK_HELD';",
    'select pg_sleep(1.5);',
    'commit;',
  ].join('\n'));

  let finalizer: ReturnType<typeof startPsql> | undefined;
  try {
    await first.ready;
    const secondOutput = await runPsql(
      `select public.begin_admin_permanent_deletion('${actorId}','${targetId}','${targetEmail}','DELETE');`,
    );
    await first.output;
    assert.match(secondOutput, /auth_delete_pending/);

    const attemptCount = await runPsql(
      `select attempt_count from public.admin_permanent_deletion_jobs where target_id='${targetId}';`,
    );
    assert.equal(attemptCount.trim(), '2');

    await runPsql(`delete from auth.users where id='${targetId}';`);
    finalizer = startPsql([
      'begin;',
      `select target_id from public.admin_permanent_deletion_jobs where target_id='${targetId}' for update;`,
      "select 'LOCK_HELD';",
      'select pg_sleep(0.75);',
      `select public.complete_admin_permanent_deletion('${actorId}','${targetId}');`,
      'commit;',
    ].join('\n'));
    await finalizer.ready;
    const competingFinalization = await runPsql(
      `select public.complete_admin_permanent_deletion('${actorId}','${targetId}');`,
    );
    const firstFinalization = await finalizer.output;
    assert.match(firstFinalization, /"status": "completed"/);
    assert.match(competingFinalization, /"status": "completed"/);
  } finally {
    if (first.child.exitCode === null && first.child.signalCode === null) first.child.kill();
    await first.output.catch(() => undefined);
    if (finalizer?.child.exitCode === null && finalizer.child.signalCode === null) finalizer.child.kill();
    await finalizer?.output.catch(() => undefined);
    await runPsql([
      `delete from public.admin_permanent_deletion_email_reservations where target_id in ('${targetId}');`,
      `delete from public.admin_permanent_deletion_jobs where target_id in ('${targetId}');`,
      `delete from public.admin_sessions where user_id in ('${targetId}','${actorId}');`,
      `delete from public.admin_audit_logs where actor_id in ('${actorId}','${targetId}') or target_id in ('${actorId}','${targetId}');`,
      `delete from public.admin_users where id in ('${targetId}','${actorId}');`,
      `delete from public.admin_identity_history where id in ('${targetId}','${actorId}');`,
      `delete from auth.users where id in ('${targetId}','${actorId}');`,
    ].join('\n'));
  }
});

test('an Auth email claim already in flight serializes before a reservation is created', {
  skip: !databaseUrl,
}, async () => {
  const actorId = randomUUID();
  const targetId = randomUUID();
  const competingIdentityId = randomUUID();
  const actorEmail = `${actorId}@example.test`;
  const targetEmail = `${targetId}@example.test`;
  const fixture = [
    `insert into auth.users (id,email) values ('${actorId}','${actorEmail}'),('${targetId}','${targetEmail}');`,
    `insert into public.admin_users (id,email,role,status,is_primary_owner,archived_at) values ('${actorId}','${actorEmail}','owner','active',true,null),('${targetId}','${targetEmail}','custom_admin','disabled',false,clock_timestamp());`,
  ].join('\n');
  await runPsql(fixture);

  const authClaim = startPsql([
    'begin;',
    `insert into auth.users (id,email,is_sso_user) values ('${competingIdentityId}','${targetEmail}',true);`,
    "select 'LOCK_HELD';",
    'select pg_sleep(1);',
    'commit;',
  ].join('\n'));

  let deletionRequest: ReturnType<typeof startPsql> | undefined;
  try {
    await authClaim.ready;
    deletionRequest = startPsql([
      `select public.begin_admin_permanent_deletion('${actorId}','${targetId}','${targetEmail}','DELETE');`,
      "select 'LOCK_HELD';",
    ].join('\n'));
    let lockWaitObserved = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const waiting = await runPsql(
        `select count(*) > 0 from pg_stat_activity where datname=current_database() and query like '%begin_admin_permanent_deletion%' and wait_event='advisory';`,
      );
      if (waiting.trim() === 't') {
        lockWaitObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(lockWaitObserved, true, 'deletion begin must wait on the in-flight Auth email claim lock');
    const authResult = await authClaim.output;
    await deletionRequest.ready;
    const deletionResult = await deletionRequest.output;
    assert.match(authResult, /LOCK_HELD/);
    assert.match(deletionResult, /auth_delete_pending/);

    await runPsql(`delete from auth.users where id='${targetId}';`);
    const completion = await runPsql(
      `select public.complete_admin_permanent_deletion('${actorId}','${targetId}');`,
    );
    assert.match(completion, /auth_identity_present/);

    const reservation = await runPsql(
      `select count(*) from public.admin_permanent_deletion_email_reservations where email='${targetEmail}';`,
    );
    assert.equal(reservation.trim(), '1');
    const competingIdentity = await runPsql(
      `select count(*) from auth.users where id='${competingIdentityId}';`,
    );
    assert.equal(competingIdentity.trim(), '1');
  } finally {
    if (authClaim.child.exitCode === null && authClaim.child.signalCode === null) authClaim.child.kill();
    await authClaim.output.catch(() => undefined);
    if (deletionRequest?.child.exitCode === null && deletionRequest.child.signalCode === null) deletionRequest.child.kill();
    await deletionRequest?.output.catch(() => undefined);
    await runPsql([
      `delete from public.admin_permanent_deletion_email_reservations where target_id='${targetId}';`,
      `delete from public.admin_permanent_deletion_jobs where target_id='${targetId}';`,
      `delete from public.admin_sessions where user_id in ('${targetId}','${actorId}');`,
      `delete from public.admin_audit_logs where actor_id in ('${actorId}','${targetId}') or target_id in ('${actorId}','${targetId}');`,
      `delete from public.admin_users where id in ('${targetId}','${actorId}');`,
      `delete from public.admin_identity_history where id in ('${targetId}','${actorId}');`,
      `delete from auth.users where id in ('${targetId}','${competingIdentityId}','${actorId}');`,
    ].join('\n'));
  }
});

function runPsql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(psqlPath, ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-d', databaseUrl!]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `psql exited with status ${code}`));
    });
    child.stdin.end(sql);
  });
}
