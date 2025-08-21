// index.js
import pkg from '@slack/bolt';
const { App, ExpressReceiver } = pkg;

import 'dotenv/config';
import { google } from 'googleapis';

// -------------------------
// Bolt & Express 初期化
// -------------------------
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoint: "/slack/events"
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// -------------------------
// Google OAuth クライアント
// -------------------------
let oauth2Client;
let googleTokens;

// OAuth 認証用URL
app.receiver.app.get("/auth", (req, res) => {
  if (!oauth2Client) return res.send("Google OAuth クライアント情報がまだ設定されていません");

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  res.redirect(url);
});

// OAuth コールバック
app.receiver.app.get("/oauth2callback", async (req, res) => {
  if (!oauth2Client) return res.send("Google OAuth クライアント情報がまだ設定されていません");

  const code = req.query.code;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  googleTokens = tokens;
  res.send("Google OAuth 完了! これでスプレッドシートに書き込めます");
});

// -------------------------
// Slack ボタン → モーダル → Sheets 書き込み
// -------------------------

// 「回答する」ボタン押下時
app.action("open_answer_modal", async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "answer_modal",
        title: { type: "plain_text", text: "回答入力" },
        submit: { type: "plain_text", text: "送信" },
        close: { type: "plain_text", text: "キャンセル" },
        private_metadata: body.actions[0].value, // Dify側の query_id
        blocks: [
          {
            type: "input",
            block_id: "answer_block",
            label: { type: "plain_text", text: "回答を入力してください" },
            element: {
              type: "plain_text_input",
              action_id: "answer_input",
              multiline: true
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error(error);
  }
});

// モーダル送信時
app.view("answer_modal", async ({ ack, body, view, client }) => {
  await ack();

  const answer = view.state.values["answer_block"]["answer_input"].value;
  const queryId = view.private_metadata;

  if (!googleTokens) {
    console.error("Google OAuth 未完了のため書き込み不可");
    return;
  }

  try {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const spreadsheetId = process.env.SPREADSHEET_ID;

    // Difyからの情報をセット（{{}} は Dify 側で送信時に展開）
    const values = [[
      "inquiry",                         // A列
      "{{#1711528708197.type#}}",        // B列
      "{{#conversation.Initial_Query#}}",// C列
      answer,                             // D列
      "{{#1711528708197.Zendesk#}}",     // E列
      "{{#1711528708197.Reference#}}"    // F列
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "マスタ!A:F",
      valueInputOption: "RAW",
      requestBody: { values }
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: "✅ 回答をスプレッドシートに保存しました！"
    });

  } catch (err) {
    console.error("Sheets書き込みエラー:", err);
  }
});

// -------------------------
// サーバー起動
// -------------------------
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡ Slack Bolt app is running!");
})();
