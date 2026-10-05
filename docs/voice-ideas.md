# Voice ideas

Create content offers **Create a draft** and **Just talk**. Talk opens a text box and microphone recorder. The real `thinking-orbs` listening animation appears during recording; reduced motion pauses it. Stop the microphone to preview the recording. Recording and server-validated mono PCM audio are capped at 90 seconds. The server never stores the audio.

Connect ElevenLabs using a restricted key with Speech to Text and User read permissions. Its key is stored in the existing authenticated, workspace-bound encrypted vault. Transcription checks included credit balance and disabled credit extensions before dispatch. There is no global provider-key fallback, purchase, credit extension, or automatic retry. The app admits at most 10 requests per workspace per UTC day; this is an application request allowance, not a provider spending guarantee. Provider retention still applies.

Explicit **Transcribe recording** sends audio to ElevenLabs Scribe v2. An uncertain result blocks another transcription until the owner checks it at the provider and acknowledges it. Request identifiers prevent replay; credential generations discard stale results after rotation or disconnect. Only request metadata is stored. Approval and publication paths are unchanged.

**Polish idea** sends editable text through the existing ChatGPT subscription backend, preserving its selected account/model, usage reservation and text-only structured response. No API-key fallback is used. Subscription polishing is available only in the configured local installation. The hosted website shows the local entry point and permits manual draft saving; it cannot claim a successful hosted subscription connection. Opening the local app does not transfer text or credentials. Save a draft explicitly to make the source available to the same authenticated workspace.

**Save draft** preserves source notes and the reviewed idea. It does not create approvals, schedules or publishing jobs.

## Verification and rollout

The public release starts from production source `b5ab3ef78a23e73e644f196ae5a1b2459bf58dfb`, verified against all 199 deployed source hashes. The private video editor is excluded. UI changes hide extra collapsed-sidebar controls, neutralize collapsed utility buttons/inactive tabs, inset select arrows, remove Vanta from the homepage and remove descriptive page/service subtext.

The additive `202610050001_voice_ideas.sql` migration preserves existing integration records and permissions. Roll back the application to deployment `dpl_DdV682XUyToGj2pCHRGHzQfNnMGJ` while retaining the additive schema. Existing code ignores the additional provider record. Disable the ElevenLabs connection before rollback if stopping all new transcription use is intended.

The voice tests verify authoritative duration/format bounds, tenant and human-owner denial, credit checks, replay, concurrent requests, credential rotation/disconnect races, uncertain results, stale account checks, workspace RLS and zero publishing side effects. Local fixture transports cannot establish real provider access. A separate two-second nonsensitive Scribe v2 test succeeded; live application verification is recorded separately in ignored deployment evidence.
