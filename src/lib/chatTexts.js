// Every piece of text the chat window shows (the assistant's own replies
// come from the ask-faq function instead). These are the defaults; on the
// Shopify store, the ware-chat snippet overrides any of them through
// window.WareChatConfig.texts (see widget/build-snippet.mjs), so the team
// can reword the chat without a rebuild.
//
// {name}, {phone} and {hours} are filled in where they appear.
export const TEXTS = {
  // Closed chat and header
  pill: "Ask me anything",
  title: "Ware concierge",
  inputPlaceholder: "Ask about a piece",
  menuNewChat: "Start a new chat",
  menuFullScreen: "Full screen",
  menuSmaller: "Smaller window",

  // Empty chat
  welcome:
    "Hi there! Welcome to Ware Innovations. I'm here to help you find the perfect piece, gift ideas, bulk orders or anything delivery related.",
  suggestions: [
    "Gift ideas below ₹2,500",
    "Gifts below ₹5,000",
    "Bulk or corporate gifting",
    "How long does delivery take?",
  ],

  // When the team can be reached (WhatsApp card, details form, thanks)
  teamHours: "Mon–Sat, 10 am – 7 pm",

  // WhatsApp card
  whatsappTitle: "Chat with the Ware team",
  whatsappSubtitle: "Continue on WhatsApp · {hours}",

  // When the assistant can't answer (AI down or out of quota)
  fallback:
    "So sorry, I'm having a little trouble answering right now. Our team would love to help though! Tap below to chat with them on WhatsApp.",

  // "What should we call you?" box
  nameBoxTitle: "What should we call you?",
  nameBoxThanks: "Lovely to meet you, {name}!",

  // "Leave your details" prompt and form
  contactPrompt: "Want our team to follow up with you?",
  contactPromptButton: "Enter your details",
  contactFormTitle: "Leave your name and number and our team will get back to you.",
  contactFormTitleCall: "Share your name and number for a quick call from our team.",
  // The same, when we already have their name (only the number is asked).
  contactFormTitleNamed: "Thanks, {name}! Leave your number and our team will get back to you.",
  contactFormTitleCallNamed: "Thanks, {name}! Share your number for a quick call from our team.",
  contactFormNote:
    "We'll only use this to get back to you about your enquiry. Our team is available {hours}.",
  contactThanks: "Thanks, {name}! Our team will reach you on {phone} ({hours}).",
  contactThanksNoName: "Thanks! Our team will reach you on {phone} ({hours}).",

  // Shared form bits
  namePlaceholder: "Your name",
  phonePlaceholder: "Phone number",
  save: "Save",
  saving: "Saving...",
  notNow: "Not now",
  saveFailed: "Couldn't save that just now. Please try again.",
  invalidPhone: "Please enter a valid phone number.",

  // Product cards and follow-ups
  soldOut: "Sold out",
  enquire: "Enquire",
  showMore: "Show more",
  moreIntro: "Here are a few more:",
  similarOffer: "Would you like to see similar products that are in stock?",
  similarButton: "Yes, show me",
  similarIntro: "Here are some pieces similar to the {name} that are in stock:",

  // On a product page: the pill, the message it sends, and the reply
  pillProduct: "Show me more products like this",
  moreLikeThisAsk: "Show me more products like this",
  moreLikeThisIntro:
    "If the {name} caught your eye, you might love these too:",
  moreLikeThisNone:
    "I couldn't find anything close to the {name} in stock right now. Our team would be glad to suggest something, just tap below.",

  // On a Ware Atelier (bespoke) piece
  pillBespoke: "Love this piece? Let's talk",
  bespokeAsk: "I'd love to know more about the {name}",
  bespokeIntro:
    "The {name} is one of our bespoke pieces, and we're so glad it caught your eye! Each one is made to order, so one of our designers would love to hear what you have in mind and create something just for you. Shall we give you a call?",
  bespokeIntroMany:
    "These are some of our bespoke pieces, and we're so glad they caught your eye! Each one is made to order, so one of our designers would love to hear what you have in mind and create something just for you. Shall we give you a call?",
  bespokeCatalog: "Browse our bespoke catalogue",
  atelierCatalogUrl:
    "https://cdn.shopify.com/s/files/1/0039/8498/2051/files/Ware_Atelier_Bespoke_Furniture_Catalog.pdf?v=1790597905",
  bespokeYes: "Yes, call me",
  bespokeFormTitle:
    "Share your name and number, and one of our designers will call you.",
  bespokeFormTitleNamed:
    "Thanks, {name}! Share your number, and one of our designers will call you.",
  bespokeWhatsApp: "Prefer WhatsApp? Chat with us instead",
  bespokeThanks:
    "Wonderful, thank you {name}! One of our designers will call you shortly from +91 96196 20099 ({hours}). Do save the number so you know it's us.",
  bespokeThanksNoName:
    "Wonderful, thank you! One of our designers will call you shortly from +91 96196 20099 ({hours}). Do save the number so you know it's us.",
  bespokeLater:
    "Of course, no rush at all. Take your time with it, and whenever you'd like to talk it through, I'm right here.",

  // Notice after adding a piece from a card
  addedToCart: "Added to your cart",
  viewCart: "View cart",

  // Under replies giving the store's address
  storeMapLabel: "Get directions on Google Maps",
  storeMapUrl: "https://maps.app.goo.gl/xvfFKjgKcb9agCtc6",

  // Team takeover
  teamJoined: "A member of the Ware team has joined the chat.",
  teamLeft: "You're chatting with the Ware assistant again.",
  sentToTeam: "Sent to the Ware team ·",
};

// Applies the store's wording over the defaults: only known keys, and only
// strings (or, for suggestions, a list of strings), so a typo can't break
// the chat.
export function setTexts(overrides) {
  if (!overrides || typeof overrides !== "object") return;
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in TEXTS)) continue;
    if (key === "suggestions") {
      if (Array.isArray(value)) {
        TEXTS.suggestions = value.filter((s) => typeof s === "string" && s.trim());
      }
    } else if (typeof value === "string") {
      TEXTS[key] = value;
    }
  }
}

// "Lovely to meet you, {name}!" -> "Lovely to meet you, Priya!"
export const fillText = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (match, key) =>
    key === "hours" ? TEXTS.teamHours : (values[key] ?? match),
  );
