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
  // The same, on the gift page (/collections/premium-handmade-diwali-gifts)
  pillGifts: "Find the perfect gift",
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
    "Track my order",
  ],
  // The chip above that the chat answers itself (keep the two the same).
  trackOrder: "Track my order",

  // When the team can be reached (WhatsApp card, details form, thanks,
  // and under the store chat's title)
  teamHours: "Mon–Sat, 10 am – 7 pm",
  // The line under "Ware concierge" (empty: none)
  status: "Online · usually replies in minutes",

  // WhatsApp card
  whatsappTitle: "Chat with the Ware team",
  // For a few seconds after the WhatsApp button is tapped.
  whatsappOpening: "Opening WhatsApp…",
  whatsappSubtitle: "Continue on WhatsApp · {hours}",

  // When the assistant can't answer (AI down or out of quota)
  fallback:
    "So sorry, I'm having a little trouble answering right now. We'd love to help though! Tap below to chat with us on WhatsApp.",

  // "What should we call you?" box
  nameBoxTitle: "What should we call you?",
  nameBoxThanks: "Lovely to meet you, {name}!",
  // Right after they give their name: an optional number, asked once
  numberBoxTitle: "Add your number in case we get disconnected, and we'll reach you on WhatsApp (optional).",
  numberBoxNote: "Only for your enquiry, never spam.",
  noThanks: "No thanks",

  // "Leave your details" prompt and form
  contactPrompt: "Want a hand choosing? Leave your number and we'll WhatsApp you a few ideas.",
  contactPromptButton: "Leave my number",
  contactFormTitle: "Leave your name and number and our team will get back to you.",
  contactFormTitleCall: "Share your name and number for a quick call from our team.",
  // The same, when we already have their name (only the number is asked).
  contactFormTitleNamed: "Thanks, {name}! Leave your number and our team will get back to you.",
  // Bulk / custom / gifting enquiries: the form opens with a reason.
  contactFormTitleQuote: "Share your name and number and we'll WhatsApp you a quote.",
  contactFormTitleQuoteNamed: "Thanks, {name}! Share your number and we'll WhatsApp you a quote.",
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
  // When we know what kind of piece it is ({kind}: cutlery, plate, cup…):
  // others of its kind, then pieces that go with it.
  moreLikeThisKind:
    "If the {name} caught your eye, here are a few more {kind} options:",
  moreLikeThisPairings: "And here's more Ware to go with your {kind}:",
  moreLikeThisOnlyPairings:
    "We don't have other {kind} options in stock right now, but these would go lovely with the {name}:",
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
  // Under replies to hotel / restaurant / café enquiries.
  horecaCatalog: "Browse our HoReCa catalogue",
  // Under festive / bulk / corporate gifting replies (Diwali, Rakhi…).
  giftCatalog: "Browse our gifting catalogue",
  giftCatalogUrl:
    "https://cdn.shopify.com/s/files/1/0039/8498/2051/files/Ware_Gift_Studio_Catalog.pdf?v=1791870937",
  horecaCatalogUrl:
    "https://cdn.shopify.com/s/files/1/0039/8498/2051/files/Ware_HORECA_Catalog_2026_30th_Sept.pdf?v=1790746449",
  atelierCatalogUrl:
    "https://cdn.shopify.com/s/files/1/0039/8498/2051/files/Ware_Atelier_Bespoke_Furniture_Catalog.pdf?v=1790597905",
  // On a product page with details (metafields): the pill opens the chat
  // with these options. Each answer comes straight from the product's own
  // details ({value}); only the ones a product has are offered.
  pillProductAsk: "I want to know more about this",
  productOptionsIntro: "Anything you'd like to know about the {name}?",
  productOptionsMore: "Anything else about the {name}?",
  optMoreLikeThis: "Show me more like this",
  // Sold-out pieces: the pill and the first option, which hands them to
  // the team on WhatsApp ({title} and {url} in the pre-filled message).
  pillSoldOut: "Check stock with our team",
  optCheckStock: "Check stock with our team",
  stockReply:
    "The {name} is sold out on our website right now, but we may still have a few pieces. Message us on WhatsApp and we'll check for you.",
  // A sold-out Claude / Arc / Horizon piece (each one of a kind), with
  // similar ones in stock as cards under it.
  stockReplyOnePiece:
    "This one is a lovely pick! Each piece is one of a kind, but we'd love to check whether we have it for you. Just tap WhatsApp below. Meanwhile, here are some similar {kind} for you.",
  stockWhatsApp:"Hi! Is the {title} available? I saw it's sold out on the website.\n{url}",
  optIncludes: "What's in the set?",
  optSize: "Size & weight",
  infoIncludes: "The {name} includes:\n{value}",
  infoDimensions: "Dimensions of the {name}:\n{value}",
  infoVolume: "Volume of the {name}:\n{value}",
  infoWeight: "Weight of the {name}:\n{value}",
  // When the detail is one line (a single piece): just the value.
  infoDimensionsOne: "It measures {value}.",
  infoVolumeOne: "It holds {value}.",
  infoWeightOne: "It weighs {value}.",
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
  // Under replies about returns, exchanges or a damaged / wrong piece.
  returnsLabel: "Start a return or exchange",
  returnsUrl: "https://www.wareinnovations.com/apps/return_prime",
  returnsNote: "Available for 14 days after delivery.",

  // "Track my order": a logged-in shopper's latest order ({order}, {date})
  orderShipped: "Your order {order} from {date} is on its way.",
  orderConfirmed:
    "Your order {order} from {date} is confirmed. We dispatch within 24 hours and email you the tracking details.",
  orderCancelled: "Your order {order} from {date} was cancelled.",
  orderTrackLabel: "Track your parcel",
  orderDetailsLabel: "Order details",
  orderAllLabel: "All your orders",
  // Logged in, but no orders on the account
  orderNone:
    "I can't see any orders on your account yet. If you ordered with another email or number, log in with that one, or message us on WhatsApp with your order number.",
  // Not logged in
  orderLoggedOut:
    "Log in to see your orders and their tracking. Or message us on WhatsApp with your order number and we'll check for you.",
  orderLoginLabel: "Log in to your account",

  // Team takeover
  teamJoined: "Ware team joined",
  // Above a team reply: with the team member's first name, or without.
  teamLabel: "Ware team",
  teamMemberLabel: "{name} · Ware team",
  teamLeft: "Back with the Ware assistant",
  sentToTeam: "Sent to the Ware team ✓",
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
