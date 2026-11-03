const commands = [
  { command: "start", description: "Open Telegram Miner" },
  { command: "help", description: "Show miner help" },
];
export async function configureTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
  if (!token || token === "replace_me" || !webAppUrl) return;
  if (!/^https:\/\//i.test(webAppUrl)) throw new Error("TELEGRAM_WEB_APP_URL must use HTTPS.");
  const endpoint = `https://api.telegram.org/bot${token}`;
  const post = async (method: string, body: unknown) => {
    const response = await fetch(`${endpoint}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Telegram ${method} failed with HTTP ${response.status}`);
  };
  await post("setMyCommands", { commands });
  await post("setChatMenuButton", { menu_button: { type: "web_app", text: "Open Miner", web_app: { url: webAppUrl } } });
}
