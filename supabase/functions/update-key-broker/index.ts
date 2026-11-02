import { createUpdateKeyBroker } from '../../../backend/src/update-key-broker.ts';
Deno.serve(
  createUpdateKeyBroker({ privateKey: () => Deno.env.get('UHM_UPDATER_SIGNING_PRIVATE_KEY') }),
);
