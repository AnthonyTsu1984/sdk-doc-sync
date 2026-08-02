# Doc Ops Lark CLI Sandbox

This container is the only supported location for test-tenant Lark authentication. It does not mount the host `~/.lark-cli`, macOS Keychain, repository `.env`, Docker socket, or production tokens.

Security properties:

- exact `@larksuite/cli` version pinned in the image;
- non-root UID/GID 10001;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges` enabled;
- isolated named volumes for Lark config and smoke state;
- local credentials excluded from the Docker build context;
- volume deletion requires an explicit reset confirmation variable.

Build and initialize:

```bash
npm run smoke:sandbox:build
npm run smoke:sandbox:init
```

The initialization prompt runs inside the container. Paste the test App ID and App Secret there. The secret is hidden and passed to `lark-cli` through stdin only.

Check the isolated profile:

```bash
npm run smoke:sandbox:profile
npm run smoke:sandbox:status
```

Start user authorization:

```bash
npm run smoke:sandbox:auth-login
npm run smoke:sandbox:qrcode -- "<verification-url>"
npm run smoke:sandbox:auth-complete -- "<device-code>"
```

Run other test-tenant CLI operations through the same isolated profile:

```bash
npm run smoke:sandbox:lark -- drive ls
```

Never run the host `lark-cli auth login` for this test environment.
