// OPTIONAL, TEMPORARY commissioning runner. Never leave deployed after verification.
// Requires a separate throwaway owner code, not the user's primary owner.
import { runLiveSmoke } from '../../../scripts/live-smoke.ts';
Deno.serve((request) => {
  const expected = Deno.env.get('UHM_DEPLOYMENT_TEST_TOKEN');
  if (
    !expected ||
    request.method !== 'POST' ||
    request.headers.get('authorization') !== `Bearer ${expected}`
  )
    return new Response('Not found', { status: 404 });
  const id = crypto.randomUUID();
  EdgeRuntime.waitUntil(
    (async () => {
      let result;
      try {
        result = await runLiveSmoke(Deno.env.get('UHM_DEPLOYMENT_TEST_CODE') || '');
      } catch (error) {
        result = { ok: false, error: String(error) };
      }
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const saved = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/audit_events`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Profile': 'uhm',
        },
        body: JSON.stringify({
          actor: 'operator:commissioning',
          action: 'deployment.smoke.finished',
          target: id,
          detail: JSON.stringify(result),
        }),
      });
      if (!saved.ok) console.error('COMMISSIONING_RESULT_SAVE_FAILED', saved.status);
    })(),
  );
  return Response.json({ started: true, run_id: id }, { status: 202 });
});
