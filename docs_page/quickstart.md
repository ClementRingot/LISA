# Quickstart

Get from zero to translating in three steps. This assumes **local development** (direct connection to SAP, no BTP).

## 1. Install the ABAP service

Import the **one** self-contained handler class `ZCL_I18N_SERVICE` from the [`abap/`](../abap) folder that matches your stack — `abap/ABAP_PLATFORM_2022/` or `abap/ABAP_PLATFORM_2025/` (on-premise / private cloud) or `abap/CLOUD/` (BTP ABAP Environment / public cloud) — create the ABAP **HTTP service** with it as handler class, and **enable** it (`UCON_HTTP_SERVICES` on S/4HANA 2022+; on ABAP Environment the endpoint activates automatically when you activate the HTTP Service object — no communication scenario needed). Full details: **[ABAP service setup](./abap-service-setup.md)**.

Smoke-test it:

```bash
curl -u USER:PASS -H 'Content-Type: application/json' \
  -X POST 'https://your-system/sap/bc/http/sap/zi18n_service/list_languages?sap-client=100' \
  -d '{}'
# → {"success":true,"data":{"languages":[...]}}
```

## 2. Run the MCP server

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```bash
SAP_URL=https://your-abap-system.example.com
SAP_USERNAME=ABAP_USER
SAP_PASSWORD=secret
SAP_CLIENT=100
SAP_I18N_SERVICE_PATH=/sap/bc/http/sap/zi18n_service
MCP_TRANSPORT=http-streamable
PORT=8080
```

Start it:

```bash
npm run dev
# MCP endpoint: http://localhost:8080/mcp   |   health: http://localhost:8080/health
```

## 3. Connect your assistant

Add to your MCP client config (Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "lisa": { "url": "http://localhost:8080/mcp" }
  }
}
```

## 4. Try it

Ask your assistant:

> "List the installed SAP languages."
> "Show the translatable texts of data element `ZMY_AMOUNT`."
> "Translate data element `ZMY_AMOUNT` to German on transport `K900123`."

Behind the scenes those map to `TranslateListLanguages`, `TranslateGetTexts`, and `TranslateSetTexts`. See **[MCP tools usage](./mcp-usage.md)** for the full surface.

## Next

- Going to production? → **[BTP deployment](./btp-deployment.md)**.
- Need auth in front of the HTTP transport? → **[Authentication](./authentication.md)**.
