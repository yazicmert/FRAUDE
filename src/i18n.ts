import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { translations } from "./api/i18n";

const resources = {
  en: { translation: translations.en },
  tr: { translation: translations.tr }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "tr", // default language
    fallbackLng: "en",
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;
