const commands = [
  { command: "start", description: "Open Telegram Miner" },
  { command: "help", description: "Show miner help" },
];

const welcomeMessage = [
  "🎉 Registration is almost complete! Open the app to launch your personal AI agent 🤖📈",
  "",
  "💵 Top up your USDT balance to level up your agent and boost your daily income 🚀",
  "",
  "👥 Invite partners and friends — earn rewards for their registrations and eligible trading activity! 🎁✨",
].join("\n");

async function telegramRequest(endpoint: string, method: string, body?: unknown) {
  const response = await fetch(`${endpoint}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json() as { ok?: boolean; result?: any; description?: string };
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || response.status}`);
  }
  return data.result;
}

async function startCommandPolling(endpoint: string, webAppUrl: string) {
  let offset = 0;
  while (true) {
    try {
      const updates = await telegramRequest(endpoint, "getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message"],
      }) as Array<any>;

      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        const message = update.message;
        const text = typeof message?.text === "string" ? message.text.trim() : "";
        if (!message?.chat?.id || !/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) continue;

        await telegramRequest(endpoint, "sendMessage", {
          chat_id: message.chat.id,
          text: welcomeMessage,
          reply_markup: {
            inline_keyboard: [[
              { text: "🚀 Launch Mini App", web_app: { url: webAppUrl } },
            ]],
          },
        });
      }
    } catch (error) {
      console.error("Telegram bot polling error:", error instanceof Error ? error.message : error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

export async function configureTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
  if (!token || token === "replace_me" || !webAppUrl) return;
  if (!/^https:\/\//i.test(webAppUrl)) throw new Error("TELEGRAM_WEB_APP_URL must use HTTPS.");

  const endpoint = `https://api.telegram.org/bot${token}`;
  await telegramRequest(endpoint, "setMyCommands", { commands });
  await telegramRequest(endpoint, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Open Miner", web_app: { url: webAppUrl } },
  });

  // Long polling is used for /start updates; Telegram permits either polling or a webhook.
  await telegramRequest(endpoint, "deleteWebhook", { drop_pending_updates: false });
  void startCommandPolling(endpoint, webAppUrl);
}
