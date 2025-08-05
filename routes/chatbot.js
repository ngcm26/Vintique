const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const OpenAI = require("openai");
const { handleIntent } = require("./intentHandler");
const { callbackConnection, createConnection } = require('../config/database');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });




router.post('/send', async (req, res) => {
  console.log('SESSION:', req.session);
  const { message } = req.body;
  const userId = req.session.user?.user_id;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const conn = await createConnection();
  try {
    // Save user message
    await conn.execute(
      'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
      [userId, message, true]
    );

    // Use intent handler
    const { intent, reply, quickReplies } = handleIntent(message);

    if (intent === "order_tracking") {
      // Order tracking logic (existing)
      try {
        const [orders] = await conn.execute(
          'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [userId]
        );
        if (orders.length > 0) {
          const latestOrder = orders[0];
          const [items] = await conn.execute(
            `SELECT oi.quantity, oi.price, l.title AS product_name, li.image_url
             FROM order_items oi
             JOIN listings l ON oi.listing_id = l.listing_id
             LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
             WHERE oi.order_id = ?`,
            [latestOrder.order_id]
          );
          const itemsText = items.map(item =>
            `${item.product_name} (x${item.quantity}) - $${Number(item.price).toFixed(2)}`
          ).join('\n');
          const imageUrl = items.length > 0 && items[0].image_url
            ? (items[0].image_url.startsWith('/') ? items[0].image_url : '/' + items[0].image_url)
            : null;
          const replyText = `Your latest order #${latestOrder.order_id} is currently: ${latestOrder.status}
Order date: ${latestOrder.created_at}
Items:
${itemsText}`;
          await conn.execute(
            'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
            [userId, replyText, false]
          );
          await conn.end();
          return res.json({ reply: replyText, image: imageUrl });
        } else {
          const replyText = "You have no recent orders.";
          await conn.execute(
            'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
            [userId, replyText, false]
          );
          await conn.end();
          return res.json({ reply: replyText });
        }
      } catch (error) {
        console.error('Order lookup error:', error);
        const replyText = "Sorry, I couldn't fetch your order details due to a system error.";
        await conn.execute(
          'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
          [userId, replyText, false]
        );
        await conn.end();
        return res.json({ reply: replyText });
      }
    }
    // --- SALES SUMMARY INTENT ---
    else if (intent === "sales_summary") {
      try {
        // Find all orders where user is the seller and order is NOT completed
        const [rows] = await conn.execute(
          `SELECT o.*, l.title, u.email AS buyer_email, oi.quantity, oi.price
           FROM orders o
           JOIN order_items oi ON o.order_id = oi.order_id
           JOIN listings l ON oi.listing_id = l.listing_id
           JOIN users u ON o.user_id = u.user_id
           WHERE l.user_id = ? AND o.status != 'completed'
           ORDER BY o.created_at DESC`,
          [userId]
        );
        if (rows.length === 0) {
          const replyText = "Great news! All your sales orders are completed.";
          await conn.execute(
            'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
            [userId, replyText, false]
          );
          await conn.end();
          return res.json({ reply: replyText });
        } else {
          const count = rows.length;
          const latest = rows[0];
          const replyText = `You have ${count} sales order(s) not completed yet. Your latest sale:\n• Order #${latest.order_id} for "${latest.title}" (Buyer: ${latest.buyer_email}, Qty: ${latest.quantity}, $${Number(latest.price).toFixed(2)}, Status: ${latest.status}).`;
          await conn.execute(
            'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
            [userId, replyText, false]
          );
          await conn.end();
          return res.json({ reply: replyText });
        }
      } catch (err) {
        console.error('Sales summary error:', err);
        const replyText = "Sorry, I couldn't fetch your sales information due to a system error.";
        await conn.execute(
          'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
          [userId, replyText, false]
        );
        await conn.end();
        return res.json({ reply: replyText });
      }
    }
    // --- All Other Handled Intents ---
    else if (reply && intent !== "order_tracking" && intent !== "default") {
      // For all other handled intents with a reply, store intent
      await conn.execute(
        'INSERT INTO ChatbotMessages (userId, message, isFromUser, intent) VALUES (?, ?, ?, ?)',
        [userId, reply, false, intent]
      );
      await conn.end();
      return res.json({ reply, quickReplies });
    }
    // --- Default: OpenAI fallback ---
    else {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4-1106-preview",
          messages: [
            { role: "system", content: "You are a friendly chatbot assistant for a sustainable e-commerce platform. Be concise and helpful. If asked about green tips, highlight sustainability." },
            { role: "user", content: message }
          ],
          max_tokens: 100,
          temperature: 0.5,
        });
        const replyText = completion.choices[0].message.content.trim();
        await conn.execute(
          'INSERT INTO ChatbotMessages (userId, message, isFromUser, intent) VALUES (?, ?, ?, ?)',
          [userId, replyText, false, "openai"]
        );
        await conn.end();
        return res.json({ reply: replyText });
      } catch (error) {
        console.error('OpenAI error:', error);
        const replyText = "Sorry, I'm unable to respond at the moment.";
        await conn.execute(
          'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
          [userId, replyText, false]
        );
        await conn.end();
        return res.json({ reply: replyText });
      }
    }
  } catch (error) {
    console.error('Chatbot error:', error);
    await conn.end();
    return res.status(500).json({ error: 'Internal server error' });
  }
});



router.get('/chat/history', async (req, res) => {
  const userId = req.session.user?.user_id;
  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const conn = await createConnection();
  const [rows] = await conn.execute(
    `SELECT message, isFromUser FROM ChatbotMessages WHERE userId = ? ORDER BY id DESC LIMIT 10`,
    [userId]
  );
  await conn.end();
  // reverse so oldest first
  res.json(rows.reverse());
});

module.exports = router;
