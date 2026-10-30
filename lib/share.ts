/**
 * A link that opens WhatsApp with this message ready to send to any chat.
 * `wa.me/?text=` without a phone number is unreliable: on some phones it
 * opens "the phone number shared via link is invalid" or stalls on
 * "Continue to chat", especially from the home-screen app. The
 * api.whatsapp.com form opens the chat picker on phones and WhatsApp Web
 * on a computer.
 */
export function whatsappShareUrl(text: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}
