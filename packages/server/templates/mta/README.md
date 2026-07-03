# Deploy LISA to SAP BTP from npm

A minimal MTA project that deploys the **published `@lisa-mcp/server` package** to Cloud
Foundry — no repo clone, no TypeScript build. The `nodejs` module is just
[`app/package.json`](./app/package.json), which depends on `@lisa-mcp/server`; `mbt build`
runs `npm install` and ships the result.

## Use it

```bash
cp -r node_modules/@lisa-mcp/server/templates/mta lisa-deploy
cd lisa-deploy
```

1. **Pin the LISA version** in `app/package.json` (`"@lisa-mcp/server": "^X.Y.Z"`).
2. **Set your landscape values** in `mta.yaml` (or in a landscape `.mtaext`):
   `SAP_BTP_DESTINATION`, `SAP_BTP_PP_DESTINATION`, `SAP_I18N_SERVICE_PATH`.
3. Build & deploy:

   ```bash
   mbt build
   cf deploy mta_archives/lisa-npm_1.0.0.mtar        # add -e my-landscape.mtaext for overrides
   ```

4. **One-off after the first deploy** — pin the DCR signing secret (it must NOT live in
   `mta.yaml`; unset, it falls back to the XSUAA clientsecret, which every deploy rotates):

   ```bash
   cf set-env lisa-mcp LISA_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"
   cf restage lisa-mcp
   ```

The MCP endpoint is `https://<route>/mcp` (read the route back with `cf app lisa-mcp`).

## Upgrade LISA

Bump the dependency, rebuild, redeploy:

```bash
(cd app && npm install @lisa-mcp/server@latest --save)
mbt build && cf deploy mta_archives/lisa-npm_1.0.0.mtar
```

## What still comes from the SAP side

- The **ABAP handler** (`ZCL_I18N_SERVICE`) must be installed in the target system —
  sources and setup guide in the [LISA repository](https://github.com/ClementRingot/LISA/tree/main/abap).
- The **destinations** (technical + principal propagation) are created in the BTP cockpit —
  see [docs: BTP deployment](https://github.com/ClementRingot/LISA/blob/main/docs_page/btp-deployment.md)
  for the per-backend destination recipes (on-premise / BTP ABAP Environment / S/4HANA Cloud),
  the optional Connectivity service (on-premise), and multi-instance `xsappname` overrides.
