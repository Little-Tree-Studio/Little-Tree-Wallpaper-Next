import { enUS } from './locales/en-US';
import { zhCN } from './locales/zh-CN';

const dictionaries = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;

export type SupportedLocale = keyof typeof dictionaries;
export type LocaleKey = keyof typeof zhCN;
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function resolveLocale(locale: string | null | undefined): SupportedLocale {
  return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

export function createTranslator(locale: SupportedLocale): TranslateFn {
  const dictionary = (dictionaries[locale] ?? dictionaries['zh-CN']) as Record<string, string>;
  const fallbackDictionary = dictionaries['zh-CN'] as Record<string, string>;

  return (key, params) => {
    const template = dictionary[key] ?? fallbackDictionary[key] ?? key;
    if (!params) {
      return template;
    }

    return Object.entries(params).reduce((message, [paramKey, value]) => {
      return message.split(`{${paramKey}}`).join(String(value));
    }, template);
  };
}