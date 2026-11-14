const commands = [
  { command: "start", description: "Open Telegram Miner" },
  { command: "help", description: "Show miner help" },
];

const welcomeMessage = [
  "🎉 Welcome to Telegram Miner!",
  "",
  "⛏️ Tap to mine points and track your mining balance.",
  "💎 Open your ETH wallet to view your wallet details.",
  "",
  "👥 Invite friends and earn referral rewards!",
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
  console.log("Telegram /start polling loop started.");
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
        const messageText = typeof message?.text === "string" ? message.text.trim() : "";
        if (!message?.chat?.id || !/^\/(?:start|help)(?:@\w+)?(?:\s|$)/i.test(messageText)) continue;

        console.log(`Telegram command received: ${messageText.split(/\\s/)[0]}`);
        await telegramRequest(endpoint, "sendMessage", {
          chat_id: message.chat.id,
          text: welcomeMessage,
          reply_markup: {
            inline_keyboard: [[
              { text: "🚀 Launch Mini App", web_app: { url: webAppUrl } },
            ]],
          },
        });
        console.log("Telegram welcome message sent.");
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
  if (!token || token === "replace_me") {
    throw new Error("TELEGRAM_BOT_TOKEN is missing or still set to replace_me in Render environment variables.");
  }
  if (!webAppUrl) {
    throw new Error("TELEGRAM_WEB_APP_URL is missing in Render environment variables.");
  }
  if (!/^https:\/\//i.test(webAppUrl)) throw new Error("TELEGRAM_WEB_APP_URL must use HTTPS.");

  const endpoint = `https://api.telegram.org/bot${token}`;
  await telegramRequest(endpoint, "setMyCommands", { commands });
  await telegramRequest(endpoint, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Open Miner", web_app: { url: webAppUrl } },
  });

  // Long polling is used for /start updates; Telegram permits either polling or a webhook.
  await telegramRequest(endpoint, "deleteWebhook", { drop_pending_updates: false });
  console.log("Telegram bot API configured; starting long polling.");
  void startCommandPolling(endpoint, webAppUrl);
}
