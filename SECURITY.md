# Security

Move Rush is a local-first static PWA. It does not collect accounts, emails,
payments, analytics, or personal data.

What is hardened:

- The page ships with a restrictive Content Security Policy and Trusted Types.
- Rendering avoids HTML string injection.
- Saved progress is normalized before display.
- Solved counts are based on known puzzle IDs from the bundled shard.
- Answer-assisted solves are practice-only and do not add solved credit.
- The service worker caches only known app assets.

What is not guaranteed:

- Browser-only stats are not authoritative. A person can still edit client-side
  code, DevTools state, or storage on their own device.
- Public leaderboards, prizes, accounts, or ranked play need server-side scoring
  and anti-abuse checks.

Report security issues privately if this repo gets a public contact address.
