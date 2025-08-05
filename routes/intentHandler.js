// intentHandler.js
// Modular intent handler for Vintique chatbot

const greenTips = [
  "Use reusable bags when shopping to reduce plastic waste!",
  "Choose secondhand items to help the environment and save money.",
  "Ship multiple items together to minimize packaging.",
  "Donate or resell items you no longer need instead of throwing them away.",
  "Opt for eco-friendly packaging when selling your products."
];

const activePromos = [
  { title: "10% Off First Purchase!", details: "Use code VINTIQUE10 at checkout." },
  { title: "Free Shipping Weekend", details: "Enjoy free shipping on all orders over $30 this weekend only!" }
];

function getRandomGreenTip() {
  return greenTips[Math.floor(Math.random() * greenTips.length)];
}

function getActivePromo() {
  if (activePromos.length === 0) return "No active promotions at the moment.";
  return activePromos.map(p => `${p.title}: ${p.details}`).join("\n");
}


function handleIntent(message) {
  const msg = message.toLowerCase();

  if (/\b(hi|hello|hey|greetings)\b/.test(msg)) {
    return {
      intent: "greeting",
      reply: `Hello! How can I assist you today? If you're looking for sustainable products or have any questions about eco-friendly practices, feel free to ask!`,
      quickReplies: [
        'Sell an Item',
        'Track Order',
        'Get Eco Tip',
        'See Promotions',
        'Return/Refund Info'
      ]
    };
  }

  if (/\b(help|what can you do|can you help|assist)\b/.test(msg)) {
    return {
      intent: "help",
      reply: `I can help you with:\n- Tracking your orders\n- Creating or managing listings\n- Payment and shipping info\n- Eco-friendly shopping tips\n- Current promotions\n- Refunds and returns\nJust ask me anything!`,
      quickReplies: [
        'Sell an Item',
        'Track Order',
        'Get Eco Tip',
        'See Promotions',
        'Return/Refund Info'
      ]
    };
  }


  if (/\b(sell|post item|upload)\b/.test(msg)) {
    return {
      intent: "selling_help",
      reply: `To sell an item:\n1. Go to 'Post Product' in your dashboard.\n2. Fill in the details and upload clear photos.\n3. Set your price and submit.\nYour listing will be live for buyers to see!`,
      quickReplies: [
        'Help',
        'Track Order',
        'Get Eco Tip'
      ]
    };
  }

  if (/\b(eco|green|sustainability)\b/.test(msg)) {
    return {
      intent: "green_tips",
      reply: getRandomGreenTip(),
      quickReplies: [
        'Help',
        'Sell an Item',
        'Track Order'
      ]
    };
  }

  if (/\b(promo|voucher|discount)\b/.test(msg)) {
    return {
      intent: "promo",
      reply: getActivePromo(),
      quickReplies: [
        'Help',
        'Sell an Item',
        'Track Order'
      ]
    };
  }

  if (/\b(refund|return)\b/.test(msg)) {
    return {
      intent: "refund_return",
      reply: `Our return policy: You can request a return or refund within 7 days of receiving your item if it is not as described. Please contact support with your order details.`,
      quickReplies: [
        'Help',
        'Sell an Item',
        'Track Order'
      ]
    };
  }

  // Order tracking handled in main route, improved regex
  if (/\b(order|orders|track|status|purchase|my orders|my order)\b/.test(msg)) {
    return { intent: "order_tracking" };
  }


  if (/\b(my sales|pending sales|open sales|uncompleted sales|sales not completed|latest sale)\b/.test(msg)) {
    return { intent: "sales_summary" };
  }

  return { intent: "default" };
}

module.exports = { handleIntent };
