import { createContext, useContext } from 'react';
import type { Category, Lang, Unit } from '../shared/types.ts';

const strings = {
  appName: { hi: 'फ़ार्महाउस', en: 'FarmHouse' },
  hello: { hi: 'नमस्ते', en: 'Hello' },
  whoAreYou: { hi: 'आप कौन हैं?', en: 'Who are you?' },
  enterPin: { hi: 'अपना 4 अंकों का PIN डालें', en: 'Enter your 4-digit PIN' },
  wrongPin: { hi: 'PIN गलत है। फिर से कोशिश करें।', en: 'Wrong PIN. Try again.' },
  locked: { hi: 'बहुत बार गलत PIN। थोड़ी देर बाद कोशिश करें:', en: 'Too many wrong PINs. Try again after' },
  back: { hi: 'पीछे', en: 'Back' },
  next: { hi: 'आगे', en: 'Next' },
  addExpense: { hi: 'खर्चा लिखें', en: 'Add expense' },
  addIncome: { hi: 'कमाई लिखें', en: 'Add income' },
  addCapital: { hi: 'मालिक से पैसा', en: 'Owner money in' },
  moneyPaid: { hi: 'पैसा दिया', en: 'Money paid out' },
  moneyReceived: { hi: 'पैसा मिला', en: 'Money received' },
  expense: { hi: 'खर्चा', en: 'Expense' },
  income: { hi: 'कमाई', en: 'Income' },
  capital: { hi: 'मालिक से पैसा', en: 'Owner capital' },
  whatExpense: { hi: 'किस चीज़ का खर्चा?', en: 'What was it spent on?' },
  whatIncome: { hi: 'किस चीज़ से कमाई?', en: 'Where did the money come from?' },
  whatCapital: { hi: 'किस तरह का पैसा?', en: 'What kind of money?' },
  howMuch: { hi: 'कितने रुपये?', en: 'How many rupees?' },
  howMuchHint: { hi: 'कई रकम हों तो + दबाकर जोड़ें', en: 'Several amounts? Press + to add them up' },
  howManyWorkers: { hi: 'कितने मज़दूर थे?', en: 'How many workers?' },
  workers: { hi: 'मज़दूर', en: 'workers' },
  skip: { hi: 'छोड़ें', en: 'Skip' },
  howMuchSold: { hi: 'कितना माल बिका?', en: 'How much was sold?' },
  howMuchSoldHint: { hi: 'पता न हो तो "छोड़ें" दबाएँ', en: 'Not sure? Press "Skip"' },
  quantity: { hi: 'मात्रा', en: 'Quantity' },
  per: { hi: 'प्रति', en: 'per' },
  photos: { hi: 'बिल / पर्ची की फ़ोटो (ज़रूरी नहीं)', en: 'Photo of bill / slip (optional)' },
  addPhoto: { hi: 'फ़ोटो जोड़ें', en: 'Add photo' },
  removePhoto: { hi: 'फ़ोटो हटाएँ', en: 'Remove photo' },
  photoLimit: { hi: 'ज़्यादा से ज़्यादा 4 फ़ोटो', en: 'Up to 4 photos' },
  photoPending: { hi: 'फ़ोटो भेजना बाकी', en: 'Photo not sent yet' },
  photoFailed: { hi: 'फ़ोटो नहीं ली जा सकी। फिर से कोशिश करें।', en: 'Could not use that photo. Try again.' },
  when: { hi: 'कब?', en: 'When?' },
  today: { hi: 'आज', en: 'Today' },
  yesterday: { hi: 'कल', en: 'Yesterday' },
  dayBefore: { hi: 'परसों', en: '2 days ago' },
  otherDate: { hi: 'दूसरी तारीख', en: 'Other date' },
  note: { hi: 'कुछ लिखना है? (ज़रूरी नहीं)', en: 'Any note? (optional)' },
  notePlaceholder: { hi: 'जैसे: सेब तोड़ने की मज़दूरी', en: 'e.g. Apple picking labour' },
  noteMicHint: { hi: 'बोलकर लिखने के लिए कीबोर्ड का 🎤 दबाएँ', en: 'Tap 🎤 on the keyboard to speak instead of typing' },
  checkAndSave: { hi: 'जाँच लें और सेव करें', en: 'Check and save' },
  save: { hi: 'सेव करें', en: 'Save' },
  saving: { hi: 'सेव हो रहा है…', en: 'Saving…' },
  saved: { hi: 'सेव हो गया!', en: 'Saved!' },
  savedOffline: { hi: 'फ़ोन में सेव हो गया। इंटरनेट आते ही भेज दिया जाएगा।', en: 'Saved on this phone. It will be sent when the internet is back.' },
  addAnother: { hi: 'एक और लिखें', en: 'Add another' },
  goHome: { hi: 'होम पर जाएँ', en: 'Go home' },
  change: { hi: 'बदलें', en: 'Change' },
  recent: { hi: 'हाल की एंट्री', en: 'Recent entries' },
  nothingYet: { hi: 'अभी कोई एंट्री नहीं।', en: 'No entries yet.' },
  todaySpent: { hi: 'आज का खर्चा', en: 'Spent today' },
  todayEarned: { hi: 'आज की कमाई', en: 'Earned today' },
  pending: { hi: 'भेजना बाकी', en: 'Not sent yet' },
  pendingFailed: { hi: 'नहीं भेजा जा सका', en: 'Could not send' },
  offline: { hi: 'इंटरनेट नहीं है। एंट्री फ़ोन में सेव होंगी।', en: 'No internet. Entries will be saved on this phone.' },
  tapToEdit: { hi: 'बदलने के लिए दबाएँ', en: 'Tap to change' },
  editEntry: { hi: 'एंट्री बदलें', en: 'Change entry' },
  deleteEntry: { hi: 'यह एंट्री हटाएँ', en: 'Delete this entry' },
  confirmDelete: { hi: 'पक्का हटाना है?', en: 'Delete this entry?' },
  yesDelete: { hi: 'हाँ, हटाएँ', en: 'Yes, delete' },
  no: { hi: 'नहीं', en: 'No' },
  deleted: { hi: 'हटा दिया', en: 'Deleted' },
  cannotEdit: { hi: 'यह एंट्री पुरानी है। बदलने के लिए मालिक से कहें।', en: 'This entry is too old to change here. Ask the admin.' },
  logout: { hi: 'बाहर निकलें', en: 'Sign out' },
  confirmLogout: { hi: 'बाहर निकलना है? दोबारा PIN डालना होगा।', en: 'Sign out? You will need your PIN again.' },
  error: { hi: 'कुछ गड़बड़ हुई। फिर से कोशिश करें।', en: 'Something went wrong. Please try again.' },
  dateTooOld: { hi: 'इतनी पुरानी तारीख नहीं चलेगी। मालिक से कहें।', en: 'That date is too far back. Ask the admin.' },
  dateFuture: { hi: 'आगे की तारीख नहीं चलेगी।', en: 'The date cannot be in the future.' },
  amountMissing: { hi: 'पहले रकम डालें', en: 'Enter an amount first' },
  monthOnly: { hi: 'पूरा महीना', en: 'whole month' },
  language: { hi: 'English', en: 'हिंदी' },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof strings;

export const LangContext = createContext<Lang>('hi');

export function useT() {
  const lang = useContext(LangContext);
  return Object.assign((key: StringKey) => strings[key][lang], { lang });
}

const UNIT_NAMES: Record<Unit, Record<Lang, string>> = {
  kg: { hi: 'किलो', en: 'kg' },
  litre: { hi: 'लीटर', en: 'litre' },
  box: { hi: 'पेटी', en: 'boxes' },
  crate: { hi: 'क्रेट', en: 'crates' },
};

export function unitName(unit: Unit, lang: Lang): string {
  return UNIT_NAMES[unit][lang];
}

export function categoryName(c: Category | undefined, lang: Lang): string {
  if (!c) return '—';
  return lang === 'hi' ? c.nameHi : c.nameEn;
}

const locale = (lang: Lang) => (lang === 'hi' ? 'hi-IN' : 'en-IN');

export function formatDate(iso: string, lang: Lang, monthOnly = false): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(locale(lang), monthOnly
    ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatWeekday(iso: string, lang: Lang): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString(locale(lang), { weekday: 'long', timeZone: 'UTC' });
}

export function formatMonth(ym: string, lang: Lang, style: 'short' | 'long' = 'short'): string {
  return new Date(ym + '-01T00:00:00Z').toLocaleDateString(locale(lang), { month: style, timeZone: 'UTC' });
}
