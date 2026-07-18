import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { translations } from "./api/i18n";

const resources = {
  en: { translation: translations.en },
  tr: { translation: translations.tr }
};

// Kayıtlı dil tercihi açılışta uygulanır; yazma tarafı useTranslation.setLanguage'dedir.
const savedLang = localStorage.getItem("i18nextLng");

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLang === "en" || savedLang === "tr" ? savedLang : "tr",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;
