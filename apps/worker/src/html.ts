import type { Env } from "./types.js";
import type { DiscordSetupStatus } from "./discord.js";
import { renderSVG } from "uqr";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    };
    return entities[character];
  });
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      :root { --accent: #2f80ed; --accent-text: #fff; color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; color: #1d252d; background: #f4f6f8; }
      header { padding: 18px 24px; color: #fff; background: #18212a; border-bottom: 4px solid var(--accent); }
      header strong { font-size: 18px; }
      main { width: min(720px, calc(100% - 32px)); margin: 40px auto; }
      h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: 0; }
      h2 { margin: 28px 0 8px; font-size: 18px; letter-spacing: 0; }
      p, li { line-height: 1.55; }
      .status { display: inline-flex; align-items: center; gap: 8px; margin: 10px 0 18px; color: #17643a; font-weight: 650; }
      .status::before { width: 9px; height: 9px; flex: 0 0 9px; content: ""; background: #2fac66; border-radius: 50%; }
      .status.pending { color: #765315; }
      .status.pending::before { background: #d49a2a; }
      .status.problem { color: #a12828; }
      .status.problem::before { background: #c83f3f; }
      .panel { margin-bottom: 20px; padding: 24px; background: #fff; border: 1px solid #d8dee5; border-radius: 8px; }
      label { display: block; margin: 18px 0 7px; font-weight: 650; }
      input, select { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #aeb8c2; border-radius: 6px; background: #fff; font: inherit; }
      button, .button { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; margin-top: 12px; padding: 9px 15px; color: var(--accent-text); background: var(--accent); border: 0; border-radius: 6px; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
      button:disabled { opacity: .6; cursor: wait; }
      button.secondary { color: #1769c2; background: #fff; border: 1px solid #1769c2; }
      code { padding: 2px 5px; background: #eaf0f5; border-radius: 4px; overflow-wrap: anywhere; }
      #result { display: none; margin-top: 18px; padding-top: 18px; border-top: 1px solid #d8dee5; }
      #chain-result { min-height: 24px; margin-top: 14px; }
      #chain-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; padding-left: 20px; }
      .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
      .error { color: #a12828; }
      .success { color: #17643a; }
      .notice { padding: 12px 14px; background: #eef5fc; border-left: 4px solid #2f80ed; }
      .muted { color: #5e6b76; }
      .rule-list { margin-top: 18px; border-top: 1px solid #d8dee5; }
      .rule-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 16px 0; border-bottom: 1px solid #d8dee5; }
      .rule-row strong, .rule-row span { display: block; overflow-wrap: anywhere; }
      .rule-row button { margin: 0; color: #a12828; background: #fff; border: 1px solid #c8a3a3; }
      .rule-group { border-bottom: 1px solid #d8dee5; }
      .rule-group-header { display: grid; grid-template-columns: minmax(0, 1fr) repeat(2, minmax(150px, auto)); gap: 16px; align-items: end; padding: 16px 0 4px; }
      .rule-group-header label { margin: 0 0 7px; font-size: 13px; }
      .rule-group-header select { min-height: 40px; }
      .rule-group .rule-row { padding-left: 16px; }
      .rule-group .rule-row:last-child { border-bottom: 0; }
      .form-actions { display: flex; justify-content: flex-end; margin-top: 20px; }
      .button-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .status-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-top: 18px; }
      .status-row .status, .status-row button { margin: 0; }
      .readiness-list { margin-top: 14px; border-top: 1px solid #d8dee5; }
      .readiness-row { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 10px; padding: 12px 0; border-bottom: 1px solid #d8dee5; }
      .readiness-dot { width: 10px; height: 10px; margin-top: 6px; border-radius: 50%; background: #2fac66; }
      .readiness-dot.waiting { background: #d49a2a; }
      .readiness-dot.problem { background: #c83f3f; }
      .readiness-row strong, .readiness-row span { display: block; }
      .readiness-row span { margin-top: 2px; color: #5e6b76; }
      .check-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; align-items: start; }
      .check-row input { width: 18px; min-height: 18px; height: 18px; margin: 3px 0 0; }
      .check-row span { display: block; }
      .icon-editor { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 16px; align-items: end; margin-top: 18px; }
      .currency-icon { width: 72px; height: 72px; object-fit: cover; border: 1px solid #aeb8c2; border-radius: 8px; background: #f4f6f8; }
      .currency-icon[hidden] + div { grid-column: 1 / -1; }
      .icon-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .icon-actions button { margin-top: 8px; }
      .brand-heading { display: flex; gap: 14px; align-items: center; margin-bottom: 10px; }
      .brand-heading h1 { margin: 0; }
      .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 16px; border-top: 1px solid #d8dee5; border-left: 1px solid #d8dee5; }
      .metric { min-width: 0; padding: 14px; border-right: 1px solid #d8dee5; border-bottom: 1px solid #d8dee5; }
      .metric strong { display: block; font-size: 22px; }
      .metric span { display: block; margin-top: 3px; color: #5e6b76; font-size: 13px; }
      .activity-list { margin-top: 16px; border-top: 1px solid #d8dee5; }
      .activity-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; padding: 12px 0; border-bottom: 1px solid #d8dee5; }
      .activity-row span { display: block; }
      .activity-row time { color: #5e6b76; font-size: 13px; white-space: nowrap; }
      [hidden] { display: none !important; }
      .wallet-address { overflow-wrap: anywhere; }
      .qr-handoff { width: min(240px, 100%); margin: 16px auto 4px; }
      .qr-handoff img { display: block; width: 100%; aspect-ratio: 1; border: 1px solid #d8dee5; background: #fff; }
      details { margin-top: 22px; border-top: 1px solid #d8dee5; padding-top: 18px; }
      summary { color: #1769c2; font-weight: 700; cursor: pointer; }
      @media (max-width: 560px) { #chain-list, .field-grid, .icon-editor, .rule-group-header { grid-template-columns: 1fr; } .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .activity-row { grid-template-columns: 1fr; gap: 4px; } }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

export function setupPage(env: Env, status: DiscordSetupStatus, advancedNetworksEnabled = false): string {
  const appName = escapeHtml(env.APP_NAME);
  const statusMessage = escapeHtml(status.message);
  const discordAction = status.ready
    ? `<a class="button" href="${escapeHtml(status.inviteUrl)}" target="_blank" rel="noopener">Add bot to Discord</a>`
    : status.local
      ? ""
      : `<a class="button" href="/">Try Discord connection again</a>`;

  return page(
    `${appName} Setup`,
    `<header><strong>${appName}</strong></header>
    <main>
      <h1>Setup</h1>
      <div class="status">App is online</div>
      <div class="panel">
        <h2>Launch check</h2>
        <div class="status-row">
          <div id="readiness-status" class="status pending" aria-live="polite">Checking everything...</div>
          <button id="retry-readiness" class="secondary" type="button">Retry launch check</button>
        </div>
        <div id="readiness-list" class="readiness-list"></div>
      </div>
      <div class="panel">
        <h2>Discord connection</h2>
        <div class="status${status.ready ? "" : status.local ? " pending" : " problem"}">${statusMessage}</div>
        ${discordAction}
      </div>
       <div class="panel">
         <h2>Networks</h2>
         <ul id="chain-list"><li>Loading networks...</li></ul>
         ${advancedNetworksEnabled ? `<details>
           <summary>Advanced network settings</summary>
          <h2>Add or update a network</h2>
          <form id="chain-form">
            <input name="username" type="text" value="setup" autocomplete="username" hidden>
            <label for="setup-token">Admin password</label>
            <input id="setup-token" type="password" autocomplete="current-password" required>
            <div class="field-grid">
              <div>
                <label for="chain-family">Chain family</label>
                <select id="chain-family" required>
                  <option value="evm">EVM</option>
                </select>
              </div>
              <div>
                <label for="chain-id">Short ID</label>
                <input id="chain-id" placeholder="future-chain" pattern="[a-z0-9][a-z0-9\\-]{1,48}" required>
              </div>
              <div>
                <label for="chain-name">Display name</label>
                <input id="chain-name" placeholder="Future Chain" required>
              </div>
              <div>
                <label for="chain-reference">Network or chain ID</label>
                <input id="chain-reference" placeholder="987654" required>
              </div>
              <div>
                <label for="chain-symbol">Native currency</label>
                <input id="chain-symbol" placeholder="FTR" pattern="[A-Z0-9]{2,10}" required>
              </div>
              <div>
                <label for="chain-rpc">Public RPC URL</label>
                <input id="chain-rpc" type="url" placeholder="https://rpc.example.com" required>
              </div>
            </div>
            <label for="chain-explorer">Block explorer URL</label>
            <input id="chain-explorer" type="url" placeholder="https://explorer.example.com">
            <button id="chain-button" type="submit">Save network</button>
          </form>
          <div id="chain-result" aria-live="polite"></div>
         </details>` : ""}
       </div>
    </main>
    <script>
      const chainForm = document.getElementById("chain-form");
      const chainResult = document.getElementById("chain-result");
      const chainButton = document.getElementById("chain-button");
      const readinessStatus = document.getElementById("readiness-status");
      const readinessList = document.getElementById("readiness-list");
      const retryReadiness = document.getElementById("retry-readiness");

      async function loadReadiness() {
        retryReadiness.disabled = true;
        readinessStatus.className = "status pending";
        readinessStatus.textContent = "Checking everything...";
        try {
          const response = await fetch("/api/setup/readiness");
          const data = await response.json();
          if (!response.ok) throw new Error("The launch check could not run.");
          readinessList.replaceChildren();
          for (const check of data.checks || []) {
            const row = document.createElement("div");
            row.className = "readiness-row";
            const dot = document.createElement("span");
            dot.className = "readiness-dot " + check.status;
            dot.setAttribute("aria-hidden", "true");
            const copy = document.createElement("div");
            const label = document.createElement("strong");
            label.textContent = check.label;
            const message = document.createElement("span");
            message.textContent = check.message;
            copy.append(label, message);
            row.append(dot, copy);
            readinessList.append(row);
          }
          const problems = (data.checks || []).filter((check) => check.status === "problem");
          const waiting = (data.checks || []).filter((check) => check.status === "waiting");
          if (data.ready) {
            readinessStatus.className = "status";
            readinessStatus.textContent = "Ready to add to Discord";
          } else if (problems.length > 0) {
            readinessStatus.className = "status problem";
            readinessStatus.textContent = problems.length === 1
              ? "One item needs attention"
              : problems.length + " items need attention";
          } else {
            readinessStatus.className = "status pending";
            readinessStatus.textContent = waiting.length === 1
              ? "Ready after deployment"
              : "Waiting for setup";
          }
        } catch (error) {
          readinessStatus.className = "status problem";
          readinessStatus.textContent = error instanceof Error ? error.message : "The launch check could not run.";
        } finally {
          retryReadiness.disabled = false;
        }
      }

      async function loadChains() {
        const response = await fetch("/api/chains");
        const data = await response.json();
        const list = document.getElementById("chain-list");
        list.replaceChildren();
        for (const chain of data.chains || []) {
          const item = document.createElement("li");
          const name = document.createElement("strong");
          name.textContent = chain.name;
          item.append(name, " - " + chain.family.toUpperCase() + " / " + chain.chainReference);
          list.append(item);
        }
      }

      chainForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        chainButton.disabled = true;
        chainResult.className = "";
        chainResult.textContent = "Saving network...";
        try {
          const value = (id) => document.getElementById(id).value.trim();
          const payload = {
            id: value("chain-id"),
            family: value("chain-family"),
            name: value("chain-name"),
            chainReference: value("chain-reference"),
            nativeCurrencySymbol: value("chain-symbol"),
            rpcUrl: value("chain-rpc") || undefined,
            explorerUrl: value("chain-explorer") || undefined
          };
          const response = await fetch("/api/setup/chains", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + document.getElementById("setup-token").value,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Network could not be saved");
          chainResult.textContent = data.chain.name + " was saved.";
          chainForm.reset();
          await loadChains();
        } catch (error) {
          chainResult.className = "error";
          chainResult.textContent = error instanceof Error ? error.message : "Network could not be saved";
        } finally {
          chainButton.disabled = false;
        }
      });

      retryReadiness.addEventListener("click", loadReadiness);
      void loadReadiness();
      loadChains().catch(() => {
        document.getElementById("chain-list").textContent = "Networks could not be loaded.";
      });
    </script>`
  );
}

export function managerPage(env: Env): string {
  const appName = escapeHtml(env.APP_NAME);
  return page(
    `${appName} Holder Roles`,
    `<header><strong>${appName}</strong></header>
    <main>
      <h1>Holder roles</h1>
      <div id="manager-status" class="status pending">Opening private manager...</div>
      <div id="manager" hidden>
        <section class="panel">
          <h2>Overview</h2>
          <div class="metrics">
            <div class="metric"><strong id="metric-members">0</strong><span>Verified members</span></div>
            <div class="metric"><strong id="metric-wallets">0</strong><span>Linked wallets</span></div>
            <div class="metric"><strong id="metric-rules">0</strong><span>Active rules</span></div>
            <div class="metric"><strong id="metric-points">0</strong><span>Reward entries</span></div>
            <div class="metric"><strong id="metric-problems">0</strong><span>Sync problems</span></div>
            <div class="metric"><strong id="metric-scheduled">Never</strong><span>Last scheduled check</span></div>
          </div>
          <div id="sync-problem-area" class="notice" hidden>
            <p id="sync-alert"></p>
            <button id="retry-sync-problems" class="secondary" type="button">Retry problem members</button>
            <span id="retry-sync-result" aria-live="polite"></span>
          </div>
          <div class="status-row">
            <div id="provider-health-status" class="status pending">Checking networks...</div>
            <button id="retry-provider-health" class="secondary" type="button">Retry network check</button>
          </div>
          <details id="provider-health-details">
            <summary>Network status</summary>
            <div id="provider-health-list" class="activity-list"></div>
          </details>
          <h2>Recent activity</h2>
          <div id="activity-list" class="activity-list"></div>
        </section>
        <section class="panel">
          <h2>Community branding</h2>
          <form id="branding-form">
            <div class="field-grid">
              <div>
                <label for="community-name">Community name</label>
                <input id="community-name" maxlength="50" required>
              </div>
              <div>
                <label for="accent-color">Accent color</label>
                <input id="accent-color" type="color" required>
              </div>
            </div>
            <div class="form-actions"><button id="save-branding" type="submit">Save branding</button></div>
          </form>
          <div id="branding-result" aria-live="polite"></div>
          <form id="logo-form" class="icon-editor">
            <img id="brand-logo" class="currency-icon" alt="" hidden>
            <div>
              <label for="logo-file">Community logo</label>
              <input id="logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required>
              <div class="icon-actions">
                <button id="upload-logo" type="submit">Upload logo</button>
                <button id="remove-logo" class="secondary" type="button" hidden>Remove logo</button>
              </div>
            </div>
          </form>
          <div id="logo-result" aria-live="polite"></div>
        </section>
        <section class="panel">
          <h2>Privacy and exports</h2>
          <form id="privacy-form">
            <label class="check-row" for="full-wallet-addresses">
              <input id="full-wallet-addresses" type="checkbox">
              <span>Allow managers to export full wallet addresses</span>
            </label>
            <p class="muted">Wallet exports use shortened addresses unless this is enabled.</p>
            <div class="form-actions"><button id="save-privacy" type="submit">Save privacy</button></div>
          </form>
          <div id="privacy-result" aria-live="polite"></div>
          <h2>Download community data</h2>
          <div id="export-actions" class="button-row">
            <button class="secondary" type="button" data-export="holders">Verified holders</button>
            <button class="secondary" type="button" data-export="balances">Reward balances</button>
            <button class="secondary" type="button" data-export="wallets">Wallet links</button>
            <button class="secondary" type="button" data-export="audit">Audit history</button>
          </div>
          <div id="export-result" aria-live="polite"></div>
        </section>
        <section class="panel">
          <h2>Community rewards</h2>
          <form id="rewards-form">
            <div class="field-grid">
              <div>
                <label for="currency-name">Currency name</label>
                <input id="currency-name" maxlength="32" required>
              </div>
              <div>
                <label for="daily-amount">Daily reward</label>
                <input id="daily-amount" type="number" min="1" max="1000000" step="1" required>
              </div>
              <div>
                <label for="holder-daily-amount">Daily holder reward</label>
                <input id="holder-daily-amount" type="number" min="0" max="1000000" step="1" required>
              </div>
            </div>
            <div class="form-actions"><button id="save-rewards" type="submit">Save rewards</button></div>
          </form>
          <div id="rewards-result" aria-live="polite"></div>
          <form id="icon-form" class="icon-editor">
            <img id="currency-icon" class="currency-icon" alt="" hidden>
            <div>
              <label for="icon-file">Currency image</label>
              <input id="icon-file" name="icon" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required>
              <div class="icon-actions">
                <button id="upload-icon" type="submit">Upload image</button>
                <button id="remove-icon" class="secondary" type="button" hidden>Remove image</button>
              </div>
            </div>
          </form>
          <div id="icon-result" aria-live="polite"></div>
        </section>
        <section class="panel">
          <h2>Add a holder role</h2>
          <form id="rule-form">
            <div class="field-grid">
              <div>
                <label for="rule-type">Requirement</label>
                <select id="rule-type" required>
                  <option value="erc721">NFT collection balance</option>
                  <option value="erc20">Token balance</option>
                  <option value="erc721-trait">NFT trait</option>
                  <option value="erc721-token">Exact NFT</option>
                  <option value="erc1155">ERC-1155 item balance</option>
                  <option value="spl-token">Solana token or NFT mint</option>
                </select>
              </div>
              <div>
                <label for="role-id">Discord role</label>
                <select id="role-id" required></select>
              </div>
              <div>
                <label for="match-mode">Role requires</label>
                <select id="match-mode" required>
                  <option value="any">Any requirement</option>
                  <option value="all">All requirements</option>
                </select>
              </div>
              <div>
                <label for="chain-id">Network</label>
                <select id="chain-id" required></select>
              </div>
              <div>
                <label for="reward-multiplier">Reward multiplier</label>
                <input id="reward-multiplier" type="number" min="1" max="100" step="1" value="1" required>
              </div>
              <div>
                <label id="asset-address-label" for="contract-address">Contract address</label>
                <input id="contract-address" inputmode="text" autocomplete="off" placeholder="0x..." required>
              </div>
            </div>
            <div id="minimum-fields">
              <label for="minimum">Minimum owned</label>
              <input id="minimum" inputmode="decimal" value="1" required>
            </div>
            <div id="token-id-fields" hidden>
              <label for="token-id">Token ID</label>
              <input id="token-id" inputmode="numeric" value="0">
            </div>
            <div id="trait-fields" class="field-grid" hidden>
              <div>
                <label for="trait-name">Trait name</label>
                <input id="trait-name" autocomplete="off">
              </div>
              <div>
                <label for="trait-value">Trait value</label>
                <input id="trait-value" autocomplete="off">
              </div>
            </div>
            <div class="form-actions"><button id="save-rule" type="submit">Add holder role</button></div>
          </form>
          <div id="form-result" aria-live="polite"></div>
        </section>
        <section class="panel">
          <h2>Active holder roles</h2>
          <div id="rule-list" class="rule-list"></div>
        </section>
        <section class="panel">
          <details>
            <summary>Advanced network settings</summary>
            <h2>Add an EVM-compatible network</h2>
            <form id="custom-chain-form">
              <div class="field-grid">
                <div>
                  <label for="custom-chain-id">Short ID</label>
                  <input id="custom-chain-id" placeholder="future-chain" pattern="[a-z0-9][a-z0-9\\-]{1,48}" required>
                </div>
                <div>
                  <label for="custom-chain-name">Network name</label>
                  <input id="custom-chain-name" placeholder="Future Chain" required>
                </div>
                <div>
                  <label for="custom-chain-reference">Numeric chain ID</label>
                  <input id="custom-chain-reference" inputmode="numeric" placeholder="987654" required>
                </div>
                <div>
                  <label for="custom-chain-symbol">Native currency</label>
                  <input id="custom-chain-symbol" placeholder="FTR" pattern="[A-Z0-9]{2,10}" required>
                </div>
              </div>
              <label for="custom-chain-rpc">Public RPC URL</label>
              <input id="custom-chain-rpc" type="url" placeholder="https://rpc.example.com" required>
              <label for="custom-chain-explorer">Block explorer URL</label>
              <input id="custom-chain-explorer" type="url" placeholder="https://explorer.example.com">
              <div class="form-actions"><button id="save-custom-chain" type="submit">Save network</button></div>
            </form>
            <div id="custom-chain-result" aria-live="polite"></div>
          </details>
        </section>
      </div>
    </main>
    <script>
      const status = document.getElementById("manager-status");
      const manager = document.getElementById("manager");
      const brandingForm = document.getElementById("branding-form");
      const brandingResult = document.getElementById("branding-result");
      const saveBranding = document.getElementById("save-branding");
      const logoForm = document.getElementById("logo-form");
      const logoFile = document.getElementById("logo-file");
      const logoPreview = document.getElementById("brand-logo");
      const uploadLogo = document.getElementById("upload-logo");
      const removeLogo = document.getElementById("remove-logo");
      const logoResult = document.getElementById("logo-result");
      const privacyForm = document.getElementById("privacy-form");
      const fullWalletAddresses = document.getElementById("full-wallet-addresses");
      const savePrivacy = document.getElementById("save-privacy");
      const privacyResult = document.getElementById("privacy-result");
      const exportActions = document.getElementById("export-actions");
      const exportResult = document.getElementById("export-result");
      const rewardsForm = document.getElementById("rewards-form");
      const rewardsResult = document.getElementById("rewards-result");
      const saveRewards = document.getElementById("save-rewards");
      const iconForm = document.getElementById("icon-form");
      const iconFile = document.getElementById("icon-file");
      const iconPreview = document.getElementById("currency-icon");
      const uploadIcon = document.getElementById("upload-icon");
      const removeIcon = document.getElementById("remove-icon");
      const iconResult = document.getElementById("icon-result");
      const form = document.getElementById("rule-form");
      const result = document.getElementById("form-result");
      const saveButton = document.getElementById("save-rule");
      const typeInput = document.getElementById("rule-type");
      const roleInput = document.getElementById("role-id");
      const matchModeInput = document.getElementById("match-mode");
      const chainInput = document.getElementById("chain-id");
      const tokenFields = document.getElementById("token-id-fields");
      const traitFields = document.getElementById("trait-fields");
      const minimumFields = document.getElementById("minimum-fields");
      const providerHealthStatus = document.getElementById("provider-health-status");
      const providerHealthDetails = document.getElementById("provider-health-details");
      const providerHealthList = document.getElementById("provider-health-list");
      const retryProviderHealth = document.getElementById("retry-provider-health");
      const syncProblemArea = document.getElementById("sync-problem-area");
      const retrySyncProblems = document.getElementById("retry-sync-problems");
      const retrySyncResult = document.getElementById("retry-sync-result");
      const customChainForm = document.getElementById("custom-chain-form");
      const saveCustomChain = document.getElementById("save-custom-chain");
      const customChainResult = document.getElementById("custom-chain-result");
      const token = new URLSearchParams(location.search).get("token");
      let data;

      if (token) history.replaceState(null, "", "/manage");

      async function api(path, options = {}) {
        const isForm = options.body instanceof FormData;
        const response = await fetch("/api/admin/" + path, {
          ...options,
          headers: {
            Authorization: "Bearer " + (token || ""),
            ...(isForm ? {} : { "Content-Type": "application/json" }),
            ...(options.headers || {})
          }
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The holder-role manager could not continue.");
        return body;
      }

      async function loadProviderHealth() {
        retryProviderHealth.disabled = true;
        providerHealthStatus.className = "status pending";
        providerHealthStatus.textContent = "Checking networks...";
        try {
          const health = await api("provider-health");
          providerHealthList.replaceChildren();
          const unhealthy = health.providers.filter((provider) => provider.status !== "healthy");
          for (const provider of health.providers) {
            const row = document.createElement("div");
            row.className = "activity-row";
            const copy = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = provider.name;
            const message = document.createElement("span");
            message.className = provider.status === "healthy" ? "muted" : "error";
            message.textContent = provider.message;
            const latency = document.createElement("time");
            latency.textContent = provider.latencyMs.toLocaleString() + " ms";
            copy.append(name, message);
            row.append(copy, latency);
            providerHealthList.append(row);
          }
          if (unhealthy.length === 0) {
            providerHealthStatus.className = "status";
            providerHealthStatus.textContent = "All networks are healthy";
          } else {
            providerHealthStatus.className = "status problem";
            providerHealthStatus.textContent = unhealthy.length === 1
              ? "1 network needs attention"
              : unhealthy.length + " networks need attention";
            providerHealthDetails.open = true;
          }
        } catch (error) {
          providerHealthStatus.className = "status problem";
          providerHealthStatus.textContent = error instanceof Error
            ? error.message
            : "Networks could not be checked.";
          providerHealthDetails.open = true;
        } finally {
          retryProviderHealth.disabled = false;
        }
      }

      function setOptions(select, items) {
        select.replaceChildren();
        for (const item of items) {
          const option = document.createElement("option");
          option.value = item.id;
          option.textContent = item.name;
          select.append(option);
        }
      }

      function updateFields() {
        const type = typeInput.value;
        tokenFields.hidden = type !== "erc721-token" && type !== "erc1155";
        traitFields.hidden = type !== "erc721-trait";
        minimumFields.hidden = type === "erc721-token";
        document.getElementById("token-id").required = !tokenFields.hidden;
        document.getElementById("trait-name").required = !traitFields.hidden;
        document.getElementById("trait-value").required = !traitFields.hidden;
        document.getElementById("minimum").required = !minimumFields.hidden;
        document.getElementById("asset-address-label").textContent = type === "spl-token" ? "Token or NFT mint address" : "Contract address";
      }

      function syncNetworkForRequirement() {
        const family = typeInput.value === "spl-token" ? "solana" : "evm";
        const selected = data && data.chains.find((chain) => chain.id === chainInput.value);
        if (!selected || selected.family !== family) {
          const compatible = data && data.chains.find((chain) => chain.family === family);
          if (compatible) chainInput.value = compatible.id;
        }
        updateFields();
      }

      function syncRequirementForNetwork() {
        const selected = data && data.chains.find((chain) => chain.id === chainInput.value);
        if (selected && selected.family === "solana") {
          typeInput.value = "spl-token";
        } else if (selected && selected.family === "evm" && typeInput.value === "spl-token") {
          typeInput.value = "erc721";
        }
        updateFields();
      }

      function syncMatchModeForRole() {
        const existing = data && data.rules.find((rule) => rule.roleId === roleInput.value);
        matchModeInput.value = existing ? existing.matchMode : "any";
        document.getElementById("reward-multiplier").value = existing
          ? String(existing.rewardMultiplier || 1)
          : "1";
      }

      function renderOperations() {
        const operations = data.operations;
        document.getElementById("metric-members").textContent = operations.verifiedMembers.toLocaleString();
        document.getElementById("metric-wallets").textContent = operations.linkedWallets.toLocaleString();
        document.getElementById("metric-rules").textContent = operations.activeRules.toLocaleString();
        document.getElementById("metric-points").textContent = operations.pointTransactions.toLocaleString();
        document.getElementById("metric-problems").textContent = operations.syncProblems.toLocaleString();
        document.getElementById("metric-scheduled").textContent = operations.lastScheduledRun
          ? new Date(operations.lastScheduledRun).toLocaleString()
          : "Never";
        const alert = document.getElementById("sync-alert");
        syncProblemArea.hidden = operations.syncProblems === 0;
        alert.textContent = operations.syncProblems === 1
          ? "1 member has a holder-role check that needs attention. Existing roles were preserved."
          : operations.syncProblems + " members have holder-role checks that need attention. Existing roles were preserved.";

        const list = document.getElementById("activity-list");
        list.replaceChildren();
        if (!operations.activity.length) {
          const empty = document.createElement("p");
          empty.className = "muted";
          empty.textContent = "No activity yet.";
          list.append(empty);
          return;
        }
        for (const item of operations.activity) {
          const row = document.createElement("div");
          row.className = "activity-row";
          const copy = document.createElement("div");
          const action = document.createElement("strong");
          action.textContent = item.action;
          const detail = document.createElement("span");
          detail.className = "muted";
          detail.textContent = item.detail + (item.kind === "audit" ? " - by ..." : " - member ...") + item.discordUserId.slice(-6);
          copy.append(action, detail);
          const time = document.createElement("time");
          time.dateTime = item.createdAt;
          time.textContent = new Date(item.createdAt).toLocaleString();
          row.append(copy, time);
          list.append(row);
        }
      }

      function ruleSummary(rule) {
        const definition = rule.definition;
        if (definition.type === "spl-token") return "Hold " + definition.minAmount + " of Solana mint";
        if (definition.type === "erc721") return "Own " + definition.minCount + " NFT(s)";
        if (definition.type === "erc20") return "Hold " + definition.minAmount + " token(s)";
        if (definition.type === "erc721-trait") return "Own " + definition.minCount + " NFT(s) with " + definition.traitName + " = " + definition.traitValue;
        if (definition.type === "erc721-token") return "Own NFT #" + definition.tokenId;
        return "Hold " + definition.minAmount + " of item #" + definition.tokenId;
      }

      function renderRules() {
        const list = document.getElementById("rule-list");
        list.replaceChildren();
        if (!data.rules.length) {
          const empty = document.createElement("p");
          empty.className = "muted";
          empty.textContent = "No holder roles yet.";
          list.append(empty);
          return;
        }
        const roles = new Map(data.roles.map((role) => [role.id, role.name]));
        const chains = new Map(data.chains.map((chain) => [chain.id, chain.name]));
        const groups = new Map();
        for (const rule of data.rules) {
          const group = groups.get(rule.roleId) || [];
          group.push(rule);
          groups.set(rule.roleId, group);
        }
        for (const [roleId, rules] of groups) {
          const group = document.createElement("div");
          group.className = "rule-group";
          const header = document.createElement("div");
          header.className = "rule-group-header";
          const title = document.createElement("strong");
          title.textContent = roles.get(roleId) || "Unavailable Discord role";
          const modeField = document.createElement("div");
          const modeLabel = document.createElement("label");
          modeLabel.textContent = "Role requires";
          const mode = document.createElement("select");
          mode.dataset.roleMode = roleId;
          modeLabel.htmlFor = "role-mode-" + roleId;
          mode.id = modeLabel.htmlFor;
          for (const optionData of [{ value: "any", label: "Any requirement" }, { value: "all", label: "All requirements" }]) {
            const option = document.createElement("option");
            option.value = optionData.value;
            option.textContent = optionData.label;
            mode.append(option);
          }
          mode.value = rules[0].matchMode || "any";
          modeField.append(modeLabel, mode);
          const multiplierField = document.createElement("div");
          const multiplierLabel = document.createElement("label");
          multiplierLabel.textContent = "Reward multiplier";
          const multiplier = document.createElement("input");
          multiplier.type = "number";
          multiplier.min = "1";
          multiplier.max = "100";
          multiplier.step = "1";
          multiplier.value = String(rules[0].rewardMultiplier || 1);
          multiplier.dataset.roleMultiplier = roleId;
          multiplierLabel.htmlFor = "role-multiplier-" + roleId;
          multiplier.id = multiplierLabel.htmlFor;
          multiplierField.append(multiplierLabel, multiplier);
          header.append(title, modeField, multiplierField);
          group.append(header);
          for (const rule of rules) {
          const row = document.createElement("div");
          row.className = "rule-row";
          const copy = document.createElement("div");
          const description = document.createElement("span");
          description.textContent = ruleSummary(rule) + " on " + (chains.get(rule.chainId) || rule.chainId);
          const address = document.createElement("span");
          address.className = "muted";
          address.textContent = rule.definition.contractAddress || rule.definition.mintAddress;
          copy.append(description, address);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.dataset.ruleId = rule.id;
          remove.textContent = "Remove";
          row.append(copy, remove);
          group.append(row);
          }
          list.append(group);
        }
      }

      typeInput.addEventListener("change", syncNetworkForRequirement);
      chainInput.addEventListener("change", syncRequirementForNetwork);
      roleInput.addEventListener("change", syncMatchModeForRole);
      retryProviderHealth.addEventListener("click", loadProviderHealth);
      retrySyncProblems.addEventListener("click", async () => {
        retrySyncProblems.disabled = true;
        retrySyncResult.className = "";
        retrySyncResult.textContent = " Retrying...";
        try {
          const report = await api("retry-sync-problems", { method: "POST", body: "{}" });
          retrySyncResult.className = report.failed ? "error" : "success";
          retrySyncResult.textContent = report.processed === 0
            ? " No problem members remain."
            : " Checked " + report.processed + "; " + report.failed + " still need attention.";
          data = await api("session");
          renderOperations();
        } catch (error) {
          retrySyncResult.className = "error";
          retrySyncResult.textContent = " " + (error instanceof Error ? error.message : "Retry could not run.");
        } finally {
          retrySyncProblems.disabled = false;
        }
      });
      customChainForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveCustomChain.disabled = true;
        customChainResult.className = "";
        customChainResult.textContent = "Checking and saving network...";
        try {
          const value = (id) => document.getElementById(id).value.trim();
          const saved = await api("chains", {
            method: "POST",
            body: JSON.stringify({
              id: value("custom-chain-id"),
              family: "evm",
              name: value("custom-chain-name"),
              chainReference: value("custom-chain-reference"),
              nativeCurrencySymbol: value("custom-chain-symbol"),
              rpcUrl: value("custom-chain-rpc") || undefined,
              explorerUrl: value("custom-chain-explorer") || undefined
            })
          });
          data.chains = data.chains.filter((chain) => chain.id !== saved.chain.id);
          data.chains.push(saved.chain);
          setOptions(chainInput, data.chains);
          updateFields();
          customChainForm.reset();
          customChainResult.className = "success";
          customChainResult.textContent = saved.chain.name + " is ready to use in holder rules.";
        } catch (error) {
          customChainResult.className = "error";
          customChainResult.textContent = error instanceof Error ? error.message : "Network could not be saved.";
        } finally {
          saveCustomChain.disabled = false;
        }
      });
      function accentTextColor(color) {
        const value = color.slice(1);
        const red = parseInt(value.slice(0, 2), 16);
        const green = parseInt(value.slice(2, 4), 16);
        const blue = parseInt(value.slice(4, 6), 16);
        return (red * 299 + green * 587 + blue * 114) / 1000 > 160 ? "#18212a" : "#ffffff";
      }

      function applyBranding() {
        document.documentElement.style.setProperty("--accent", data.branding.accentColor);
        document.documentElement.style.setProperty("--accent-text", accentTextColor(data.branding.accentColor));
        document.querySelector("header strong").textContent = data.branding.name;
        document.title = data.branding.name + " Holder Roles";
      }

      function renderBrandLogo() {
        logoPreview.hidden = !data.brandLogoUrl;
        removeLogo.hidden = !data.brandLogoUrl;
        if (data.brandLogoUrl) logoPreview.src = data.brandLogoUrl;
        else logoPreview.removeAttribute("src");
      }

      privacyForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        savePrivacy.disabled = true;
        privacyResult.className = "";
        privacyResult.textContent = "Saving...";
        try {
          const saved = await api("privacy", {
            method: "PUT",
            body: JSON.stringify({ managersCanViewFullAddresses: fullWalletAddresses.checked })
          });
          data.privacy = saved.privacy;
          privacyResult.className = "success";
          privacyResult.textContent = saved.privacy.managersCanViewFullAddresses
            ? "Full wallet addresses are available to managers."
            : "Manager exports use shortened wallet addresses.";
        } catch (error) {
          privacyResult.className = "error";
          privacyResult.textContent = error instanceof Error ? error.message : "Privacy could not be updated.";
        } finally {
          savePrivacy.disabled = false;
        }
      });

      exportActions.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-export]");
        if (!button) return;
        button.disabled = true;
        exportResult.className = "";
        exportResult.textContent = "Preparing download...";
        try {
          const response = await fetch("/api/admin/exports/" + encodeURIComponent(button.dataset.export), {
            headers: { Authorization: "Bearer " + (token || "") }
          });
          if (!response.ok) {
            const body = await response.json();
            throw new Error(body.error || "Export could not be prepared.");
          }
          const disposition = response.headers.get("Content-Disposition") || "";
          const match = disposition.match(/filename="([^"]+)"/);
          const filename = match ? match[1] : "holder-rewards-export.csv";
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          exportResult.className = "success";
          exportResult.textContent = "Download ready.";
        } catch (error) {
          exportResult.className = "error";
          exportResult.textContent = error instanceof Error ? error.message : "Export could not be prepared.";
        } finally {
          button.disabled = false;
        }
      });

      brandingForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveBranding.disabled = true;
        brandingResult.textContent = "Saving...";
        try {
          const saved = await api("branding", {
            method: "PUT",
            body: JSON.stringify({
              name: document.getElementById("community-name").value,
              accentColor: document.getElementById("accent-color").value
            })
          });
          data.branding = saved.branding;
          applyBranding();
          brandingResult.className = "success";
          brandingResult.textContent = "Branding updated.";
        } catch (error) {
          brandingResult.className = "error";
          brandingResult.textContent = error instanceof Error ? error.message : "Branding could not be updated.";
        } finally {
          saveBranding.disabled = false;
        }
      });

      logoForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!logoFile.files[0]) return;
        uploadLogo.disabled = true;
        logoResult.textContent = "Uploading...";
        try {
          const formData = new FormData();
          formData.set("logo", logoFile.files[0]);
          const saved = await api("brand-logo", { method: "POST", body: formData });
          data.brandLogoUrl = saved.brandLogoUrl;
          renderBrandLogo();
          logoForm.reset();
          logoResult.className = "success";
          logoResult.textContent = "Community logo updated.";
        } catch (error) {
          logoResult.className = "error";
          logoResult.textContent = error instanceof Error ? error.message : "Logo could not be uploaded.";
        } finally {
          uploadLogo.disabled = false;
        }
      });

      removeLogo.addEventListener("click", async () => {
        removeLogo.disabled = true;
        try {
          await api("brand-logo", { method: "DELETE" });
          data.brandLogoUrl = null;
          renderBrandLogo();
          logoResult.className = "success";
          logoResult.textContent = "Community logo removed.";
        } catch (error) {
          logoResult.className = "error";
          logoResult.textContent = error instanceof Error ? error.message : "Logo could not be removed.";
        } finally {
          removeLogo.disabled = false;
        }
      });

      function renderCurrencyIcon() {
        iconPreview.hidden = !data.currencyIconUrl;
        removeIcon.hidden = !data.currencyIconUrl;
        if (data.currencyIconUrl) iconPreview.src = data.currencyIconUrl;
        else iconPreview.removeAttribute("src");
      }

      iconForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!iconFile.files[0]) return;
        uploadIcon.disabled = true;
        iconResult.className = "";
        iconResult.textContent = "Uploading...";
        try {
          const formData = new FormData();
          formData.set("icon", iconFile.files[0]);
          const saved = await api("currency-icon", { method: "POST", body: formData });
          data.currencyIconUrl = saved.currencyIconUrl;
          renderCurrencyIcon();
          iconForm.reset();
          iconResult.className = "success";
          iconResult.textContent = "Currency image updated.";
        } catch (error) {
          iconResult.className = "error";
          iconResult.textContent = error instanceof Error ? error.message : "Image could not be uploaded.";
        } finally {
          uploadIcon.disabled = false;
        }
      });

      removeIcon.addEventListener("click", async () => {
        removeIcon.disabled = true;
        try {
          await api("currency-icon", { method: "DELETE" });
          data.currencyIconUrl = null;
          renderCurrencyIcon();
          iconResult.className = "success";
          iconResult.textContent = "Currency image removed.";
        } catch (error) {
          iconResult.className = "error";
          iconResult.textContent = error instanceof Error ? error.message : "Image could not be removed.";
        } finally {
          removeIcon.disabled = false;
        }
      });

      rewardsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveRewards.disabled = true;
        rewardsResult.className = "";
        rewardsResult.textContent = "Saving...";
        try {
          const saved = await api("rewards", {
            method: "PUT",
            body: JSON.stringify({
              currencyName: document.getElementById("currency-name").value,
              dailyClaimAmount: document.getElementById("daily-amount").value,
              holderDailyAmount: document.getElementById("holder-daily-amount").value
            })
          });
          data.rewards = saved.rewards;
          rewardsResult.className = "success";
          rewardsResult.textContent = "Rewards updated.";
        } catch (error) {
          rewardsResult.className = "error";
          rewardsResult.textContent = error instanceof Error ? error.message : "Rewards could not be updated.";
        } finally {
          saveRewards.disabled = false;
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveButton.disabled = true;
        result.className = "";
        result.textContent = "Saving...";
        try {
          const value = (id) => document.getElementById(id).value.trim();
          const payload = {
            type: typeInput.value,
            roleId: roleInput.value,
            chainId: chainInput.value,
            contractAddress: value("contract-address"),
            minimum: value("minimum"),
            tokenId: value("token-id"),
            traitName: value("trait-name"),
            traitValue: value("trait-value"),
            matchMode: matchModeInput.value,
            rewardMultiplier: value("reward-multiplier")
          };
          const saved = await api("rules", { method: "POST", body: JSON.stringify(payload) });
          for (const existing of data.rules) {
            if (existing.roleId === saved.rule.roleId) existing.matchMode = saved.rule.matchMode;
          }
          data.rules.push(saved.rule);
          renderRules();
          form.reset();
          syncMatchModeForRole();
          updateFields();
          result.className = "success";
          result.textContent = "Holder role added.";
        } catch (error) {
          result.className = "error";
          result.textContent = error instanceof Error ? error.message : "Holder role could not be added.";
        } finally {
          saveButton.disabled = false;
        }
      });

      document.getElementById("rule-list").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-rule-id]");
        if (!button) return;
        button.disabled = true;
        try {
          await api("rules/" + encodeURIComponent(button.dataset.ruleId), { method: "DELETE" });
          data.rules = data.rules.filter((rule) => rule.id !== button.dataset.ruleId);
          renderRules();
        } catch (error) {
          result.className = "error";
          result.textContent = error instanceof Error ? error.message : "Holder role could not be removed.";
          button.disabled = false;
        }
      });

      document.getElementById("rule-list").addEventListener("change", async (event) => {
        const multiplier = event.target.closest("input[data-role-multiplier]");
        if (multiplier) {
          multiplier.disabled = true;
          result.className = "";
          result.textContent = "Saving reward multiplier...";
          try {
            const saved = await api("role-multiplier", {
              method: "PUT",
              body: JSON.stringify({
                roleId: multiplier.dataset.roleMultiplier,
                rewardMultiplier: multiplier.value
              })
            });
            for (const rule of data.rules) {
              if (rule.roleId === saved.roleId) rule.rewardMultiplier = saved.rewardMultiplier;
            }
            result.className = "success";
            result.textContent = "Reward multiplier updated.";
          } catch (error) {
            result.className = "error";
            result.textContent = error instanceof Error ? error.message : "Reward multiplier could not be updated.";
            renderRules();
          } finally {
            multiplier.disabled = false;
          }
          return;
        }
        const select = event.target.closest("select[data-role-mode]");
        if (!select) return;
        select.disabled = true;
        result.className = "";
        result.textContent = "Saving role requirements...";
        try {
          const saved = await api("rule-mode", {
            method: "PUT",
            body: JSON.stringify({ roleId: select.dataset.roleMode, matchMode: select.value })
          });
          for (const rule of data.rules) {
            if (rule.roleId === saved.roleId) rule.matchMode = saved.matchMode;
          }
          if (roleInput.value === saved.roleId) matchModeInput.value = saved.matchMode;
          result.className = "success";
          result.textContent = "Role requirements updated.";
        } catch (error) {
          result.className = "error";
          result.textContent = error instanceof Error ? error.message : "Role requirements could not be updated.";
          renderRules();
        } finally {
          select.disabled = false;
        }
      });

      async function initialize() {
        if (!token) throw new Error("This manager link is invalid or incomplete.");
        data = await api("session");
        setOptions(roleInput, data.roles);
        setOptions(chainInput, data.chains);
        syncMatchModeForRole();
        document.getElementById("community-name").value = data.branding.name;
        document.getElementById("accent-color").value = data.branding.accentColor;
        document.getElementById("currency-name").value = data.rewards.currencyName;
        document.getElementById("daily-amount").value = data.rewards.dailyClaimAmount;
        document.getElementById("holder-daily-amount").value = data.rewards.holderDailyAmount;
        fullWalletAddresses.checked = data.privacy.managersCanViewFullAddresses;
        renderCurrencyIcon();
        renderBrandLogo();
        applyBranding();
        renderOperations();
        if (!data.roles.length) {
          form.hidden = true;
          result.className = "error";
          result.textContent = "Move the bot's Discord role above at least one role, then open a new manager link.";
        }
        updateFields();
        renderRules();
        status.className = "status";
        status.textContent = "Private manager is ready";
        manager.hidden = false;
        void loadProviderHealth();
      }

      initialize().catch((error) => {
        status.className = "status problem";
        status.textContent = error instanceof Error ? error.message : "The private manager could not be opened.";
      });
    </script>`
  );
}

export function verifyPage(env: Env, verificationUrl: string): string {
  const appName = escapeHtml(env.APP_NAME);
  const qrDataUrl = `data:image/svg+xml,${encodeURIComponent(
    renderSVG(verificationUrl, { ecc: "M", border: 4 })
  )}`;

  return page(
    `${appName} Verification`,
    `<header><strong>${appName}</strong></header>
    <main>
      <div class="brand-heading">
        <img id="verification-logo" class="currency-icon" alt="" hidden>
        <h1>Wallet verification</h1>
      </div>
      <div class="panel">
        <p id="intro">Checking your private verification link...</p>
        <div id="wallet-flow" hidden>
          <h2>Linked wallets</h2>
          <div id="linked-wallets" class="rule-list"></div>
          <h2>Link another wallet</h2>
          <label for="network">Network</label>
          <select id="network"></select>
          <div id="wallet-provider-field" hidden>
            <label for="wallet-provider">Wallet</label>
            <select id="wallet-provider"></select>
          </div>
          <p id="wallet-address" class="wallet-address"></p>
          <button id="connect-button" type="button">Connect wallet</button>
          <div id="wallet-handoff" hidden>
            <div class="qr-handoff">
              <img src="${qrDataUrl}" alt="QR code for this private verification link">
            </div>
            <p class="muted">Scan with your phone, then open the link in your wallet's browser.</p>
            <div class="button-row">
              <button id="share-link" type="button">Share private link</button>
              <button id="copy-link" class="secondary" type="button">Copy private link</button>
            </div>
          </div>
          <div id="verification-result" aria-live="polite"></div>
        </div>
        <h2>Safety</h2>
        <p class="notice">Continue only if you opened this page from the verification button in your community's Discord server. The bot will not send verification links by DM. This page only requests a readable signature, never a token approval, asset transfer, or blockchain transaction.</p>
      </div>
    </main>
    <script>
      const intro = document.getElementById("intro");
      const flow = document.getElementById("wallet-flow");
      const network = document.getElementById("network");
      const walletProviderField = document.getElementById("wallet-provider-field");
      const walletProviderSelect = document.getElementById("wallet-provider");
      const connectButton = document.getElementById("connect-button");
      const walletHandoff = document.getElementById("wallet-handoff");
      const shareLinkButton = document.getElementById("share-link");
      const copyLinkButton = document.getElementById("copy-link");
      const walletAddress = document.getElementById("wallet-address");
      const verificationResult = document.getElementById("verification-result");
      const verificationLogo = document.getElementById("verification-logo");
      const linkedWallets = document.getElementById("linked-wallets");
      const privateVerificationUrl = window.location.href;
      const sessionToken = new URLSearchParams(window.location.search).get("token");
      let chains = [];
      let wallets = [];
      const walletProviders = [];
      const solanaProviders = [];

      if (sessionToken) {
        history.replaceState(null, "", "/verify");
      }

      async function post(path, body) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Verification could not continue.");
        return data;
      }

      function showError(error) {
        verificationResult.className = "error";
        verificationResult.textContent = error instanceof Error ? error.message : "Verification could not continue.";
      }

      function renderProviders() {
        const chain = chains.find((item) => item.id === network.value);
        const providers = chain && chain.family === "solana" ? solanaProviders : walletProviders;
        const selected = walletProviderSelect.value;
        walletProviderSelect.replaceChildren();
        providers.forEach((entry, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = entry.name;
          walletProviderSelect.append(option);
        });
        if (selected && Number(selected) < providers.length) {
          walletProviderSelect.value = selected;
        }
        walletProviderField.hidden = providers.length < 2;
        connectButton.hidden = providers.length === 0;
        walletHandoff.hidden = providers.length !== 0;
      }

      function addProvider(provider, name, id) {
        if (!provider || typeof provider.request !== "function") return;
        if (walletProviders.some((entry) => entry.provider === provider || (id && entry.id === id))) return;
        walletProviders.push({ provider, name: name || "Browser wallet", id: id || "" });
        renderProviders();
      }

      function addSolanaProvider(provider, name, id, standardWallet) {
        if (!provider) return;
        if (solanaProviders.some((entry) => entry.provider === provider || (id && entry.id === id))) return;
        solanaProviders.push({ provider, name: name || "Solana wallet", id: id || "", standardWallet: Boolean(standardWallet) });
        renderProviders();
      }

      window.addEventListener("eip6963:announceProvider", (event) => {
        const detail = event.detail;
        if (!detail || !detail.info) return;
        addProvider(detail.provider, detail.info.name, detail.info.uuid);
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));

      const walletStandardApi = Object.freeze({
        register(...registeredWallets) {
          for (const wallet of registeredWallets) {
            if (wallet && wallet.features && wallet.features["solana:signMessage"]) {
              addSolanaProvider(wallet, wallet.name, wallet.name, true);
            }
          }
          return () => {};
        }
      });
      window.addEventListener("wallet-standard:register-wallet", (event) => {
        if (typeof event.detail === "function") event.detail(walletStandardApi);
      });
      window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: walletStandardApi }));

      function copyPrivateLink() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(privateVerificationUrl);
        }
        const field = document.createElement("textarea");
        field.value = privateVerificationUrl;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        document.execCommand("copy");
        field.remove();
        return Promise.resolve();
      }

      function renderWallets() {
        linkedWallets.replaceChildren();
        if (!wallets.length) {
          const empty = document.createElement("p");
          empty.className = "muted";
          empty.textContent = "No linked wallets.";
          linkedWallets.append(empty);
          return;
        }
        for (const wallet of wallets) {
          const row = document.createElement("div");
          row.className = "rule-row";
          const copy = document.createElement("div");
          const family = document.createElement("strong");
          family.textContent = wallet.family.toUpperCase();
          const address = document.createElement("span");
          address.className = "muted wallet-address";
          address.textContent = wallet.address;
          copy.append(family, address);
          const unlink = document.createElement("button");
          unlink.type = "button";
          unlink.dataset.walletId = wallet.id;
          unlink.textContent = "Unlink";
          row.append(copy, unlink);
          linkedWallets.append(row);
        }
      }

      async function loadSession() {
        const data = await post("/api/verify/session", { sessionToken });
        document.documentElement.style.setProperty("--accent", data.branding.accentColor);
        const color = data.branding.accentColor.slice(1);
        const brightness = (
          parseInt(color.slice(0, 2), 16) * 299 +
          parseInt(color.slice(2, 4), 16) * 587 +
          parseInt(color.slice(4, 6), 16) * 114
        ) / 1000;
        document.documentElement.style.setProperty("--accent-text", brightness > 160 ? "#18212a" : "#ffffff");
        document.querySelector("header strong").textContent = data.branding.name;
        document.title = data.branding.name + " Verification";
        verificationLogo.hidden = !data.brandLogoUrl;
        if (data.brandLogoUrl) verificationLogo.src = data.brandLogoUrl;
        chains = data.chains;
        wallets = data.wallets;
        network.replaceChildren();
        for (const chain of chains) {
          const option = document.createElement("option");
          option.value = chain.id;
          option.textContent = chain.name;
          network.append(option);
        }
        renderWallets();
      }

      async function initialize() {
        if (!sessionToken) {
          throw new Error("Open Discord and click Verify Wallet again to get a private verification link.");
        }
        await loadSession();
        if (walletProviders.length === 0 && window.ethereum) {
          const legacyProviders = Array.isArray(window.ethereum.providers)
            ? window.ethereum.providers
            : [window.ethereum];
          legacyProviders.forEach((provider, index) => {
            addProvider(provider, legacyProviders.length > 1 ? "Browser wallet " + (index + 1) : "Browser wallet");
          });
        }
        if (window.phantom && window.phantom.solana) {
          addSolanaProvider(window.phantom.solana, "Phantom", "legacy-phantom", false);
        }
        if (window.solflare) {
          addSolanaProvider(window.solflare, "Solflare", "legacy-solflare", false);
        }
        renderProviders();
        intro.textContent = "Wallets linked to your Discord account";
        flow.hidden = false;
      }

      async function switchNetwork(provider, chain) {
        const chainId = "0x" + Number(chain.chainReference).toString(16);
        const current = await provider.request({ method: "eth_chainId" });
        if (String(current).toLowerCase() === chainId.toLowerCase()) return;

        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
        } catch (error) {
          if (error && error.code === 4902 && chain.defaultRpcUrl) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId,
                chainName: chain.name,
                nativeCurrency: {
                  name: chain.nativeCurrencySymbol,
                  symbol: chain.nativeCurrencySymbol,
                  decimals: 18
                },
                rpcUrls: [chain.defaultRpcUrl],
                blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : undefined
              }]
            });
            return;
          }
          throw new Error("Switch your wallet to " + chain.name + " and try again.");
        }
      }

      function bytesToBase64(bytes) {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      }

      async function connectSolana(entry, chain) {
        const messageEncoder = new TextEncoder();
        let address;
        let signer;
        if (entry.standardWallet) {
          const wallet = entry.provider;
          let accounts = wallet.accounts || [];
          if (!accounts.length && wallet.features["standard:connect"]) {
            const connected = await wallet.features["standard:connect"].connect();
            accounts = connected.accounts || wallet.accounts || [];
          }
          const account = accounts.find((candidate) =>
            candidate.features && candidate.features.includes("solana:signMessage") &&
            (!candidate.chains || candidate.chains.includes("solana:mainnet"))
          ) || accounts[0];
          if (!account) throw new Error("Your Solana wallet did not provide an account.");
          address = account.address;
          signer = async (message) => {
            const outputs = await wallet.features["solana:signMessage"].signMessage({
              account,
              message: messageEncoder.encode(message)
            });
            if (!outputs || !outputs[0] || !outputs[0].signature) {
              throw new Error("Your Solana wallet did not return a signature.");
            }
            return bytesToBase64(outputs[0].signature);
          };
        } else {
          const provider = entry.provider;
          const connected = await provider.connect();
          address = String((connected && connected.publicKey) || provider.publicKey || "");
          signer = async (message) => {
            const output = await provider.signMessage(messageEncoder.encode(message), "utf8");
            if (!output || !output.signature) throw new Error("Your Solana wallet did not return a signature.");
            return bytesToBase64(output.signature);
          };
        }
        if (!address) throw new Error("Your Solana wallet did not provide an account.");
        walletAddress.textContent = "Connected wallet: " + address;
        const challenge = await post("/api/verify/challenge", {
          sessionToken,
          address,
          chainId: chain.id
        });
        verificationResult.textContent = "Review and sign the readable verification message in your wallet.";
        return { challenge, signature: await signer(challenge.message) };
      }

      network.addEventListener("change", renderProviders);

      connectButton.addEventListener("click", async () => {
        connectButton.disabled = true;
        verificationResult.className = "";
        verificationResult.textContent = "Waiting for your wallet...";
        try {
          const chain = chains.find((item) => item.id === network.value);
          if (!chain) throw new Error("Choose an enabled network.");
          const providers = chain.family === "solana" ? solanaProviders : walletProviders;
          const selectedProvider = providers[Number(walletProviderSelect.value) || 0];
          const provider = selectedProvider && selectedProvider.provider;
          if (!provider || (chain.family === "evm" && typeof provider.request !== "function")) {
            throw new Error("No " + (chain.family === "solana" ? "Solana" : "EVM") + " wallet was found in this browser. Share or copy this private link into your wallet browser.");
          }
          let challenge;
          let signature;
          if (chain.family === "solana") {
            ({ challenge, signature } = await connectSolana(selectedProvider, chain));
          } else {
            const accounts = await provider.request({ method: "eth_requestAccounts" });
            const address = accounts && accounts[0];
            if (!address) throw new Error("Your wallet did not provide an account.");
            walletAddress.textContent = "Connected wallet: " + address;
            await switchNetwork(provider, chain);
            challenge = await post("/api/verify/challenge", {
              sessionToken,
              address,
              chainId: chain.id
            });
            verificationResult.textContent = "Review and sign the readable verification message in your wallet.";
            signature = await provider.request({
              method: "personal_sign",
              params: [challenge.message, address]
            });
          }
          const completed = await post("/api/verify/complete", {
            sessionToken,
            challengeId: challenge.challengeId,
            signature
          });
          verificationResult.className = "success";
          const addedRoles = completed.roleSync && completed.roleSync.added ? completed.roleSync.added.length : 0;
          const roleErrors = completed.roleSync && completed.roleSync.errors ? completed.roleSync.errors.length : 0;
          verificationResult.textContent = roleErrors > 0
            ? "Wallet linked successfully. Some holder roles could not be checked; use /verify refresh in Discord shortly."
            : addedRoles > 0
              ? "Wallet linked successfully and " + addedRoles + " holder role(s) were added. You can return to Discord."
              : "Wallet linked successfully. You can return to Discord.";
          walletAddress.textContent = "Linked wallet: " + completed.wallet.address;
          connectButton.textContent = "Link another wallet";
          connectButton.className = "secondary";
          await loadSession();
        } catch (error) {
          showError(error);
        } finally {
          connectButton.disabled = false;
        }
      });

      shareLinkButton.addEventListener("click", async () => {
        try {
          if (navigator.share) {
            await navigator.share({ title: "Wallet verification", url: privateVerificationUrl });
            return;
          }
          await copyPrivateLink();
          verificationResult.className = "success";
          verificationResult.textContent = "Private link copied. Open it in your wallet browser.";
        } catch (error) {
          if (!error || error.name !== "AbortError") showError(error);
        }
      });

      copyLinkButton.addEventListener("click", async () => {
        try {
          await copyPrivateLink();
          verificationResult.className = "success";
          verificationResult.textContent = "Private link copied. Open it in your wallet browser.";
        } catch {
          showError(new Error("The link could not be copied. Use your browser's Share command instead."));
        }
      });

      linkedWallets.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-wallet-id]");
        if (!button) return;
        button.disabled = true;
        verificationResult.className = "";
        verificationResult.textContent = "Removing wallet...";
        try {
          const response = await post("/api/verify/unlink", {
            sessionToken,
            walletId: button.dataset.walletId
          });
          wallets = wallets.filter((wallet) => wallet.id !== button.dataset.walletId);
          renderWallets();
          const removedRoles = response.roleSync && response.roleSync.removed ? response.roleSync.removed.length : 0;
          verificationResult.className = "success";
          verificationResult.textContent = removedRoles > 0
            ? "Wallet unlinked and " + removedRoles + " holder role(s) were removed."
            : "Wallet unlinked.";
        } catch (error) {
          showError(error);
          button.disabled = false;
        }
      });

      initialize().catch((error) => {
        intro.className = "error";
        intro.textContent = error instanceof Error ? error.message : "This verification link is unavailable.";
      });
    </script>`
  );
}
