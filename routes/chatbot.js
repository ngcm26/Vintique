const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const OpenAI = require("openai");
const { handleIntent } = require("./intentHandler");

require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '#Wongairbus320@',
  database: 'vintiquedb'
};



router.post('/send', async (req, res) => {
  console.log('SESSION:', req.session);
  const { message } = req.body;
  const userId = req.session.user?.user_id;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const conn = await mysql.createConnection(dbConfig);
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
    } else if (reply) {
      // For all other handled intents with a reply
      await conn.execute(
        'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
        [userId, reply, false]
      );
      await conn.end();
      return res.json({ reply, quickReplies });
    } else {
      // Default: OpenAI fallback
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
          'INSERT INTO ChatbotMessages (userId, message, isFromUser) VALUES (?, ?, ?)',
          [userId, replyText, false]
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


module.exports = router;
