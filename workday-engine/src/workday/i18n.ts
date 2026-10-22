/**
 * Multilingual text patterns. Workday's data-automation-ids are the same in
 * every locale, but step names, buttons, options and question labels are
 * translated. Covered: English, German, French, Spanish, Portuguese, Italian,
 * Dutch, Polish, plus common Japanese / Chinese strings.
 */

const rx = (parts: string[], flags = "iu") => new RegExp(parts.join("|"), flags);

/* ---------------- buttons ---------------- */

/** The final Submit button. The engine must never click anything matching this. */
export const SUBMIT_RX = rx([
  "submit", "send application",
  "absenden", "einreichen", "bewerbung (senden|abschicken)", "abschicken",
  "soumettre", "envoyer( (ma|la) candidature)?",
  "enviar( (mi|la) (solicitud|candidatura))?", "presentar( (mi|la) (solicitud|candidatura))?",
  "submeter", "enviar candidatura",
  "invia(re)?( (la )?candidatura)?",
  "verzenden", "indienen", "versturen",
  "wyślij", "prześlij", "złóż aplikację",
  "送信", "提出", "応募する", "提交", "递交", "提交申请",
]);

export const NEXT_TEXT_RX = rx([
  "^(save and continue|next|continue)$",
  "^(speichern und (fortfahren|weiter)|weiter|fortfahren)$",
  "^(enregistrer et continuer|suivant|continuer)$",
  "^(guardar y continuar|siguiente|continuar)$",
  "^(salvar e continuar|próximo|avançar|continuar)$",
  "^(salva e continua|avanti|continua)$",
  "^(opslaan en doorgaan|volgende|doorgaan)$",
  "^(zapisz i kontynuuj|dalej|kontynuuj)$",
  "^(保存して続行|次へ|続行|保存并继续|下一步|继续)$",
]);

export const APPLY_TEXT_RX = rx([
  "^apply( now)?$", "^jetzt bewerben$", "^bewerben$", "^postuler$", "^postuler maintenant$",
  "^(postularme|postular|postularse|aplicar|solicitar)( ahora)?$", "^candidatar(-se)?$", "^candidati$", "^candidarsi$",
  "^solliciteren$", "^nu solliciteren$", "^aplikuj$", "^aplikuj teraz$", "^応募する$", "^応募$", "^申请$", "^立即申请$",
]);

export const ADD_TEXT_RX = rx([
  "^add( another)?$", "^hinzufügen$", "^weitere hinzufügen$", "^ajouter$", "^ajouter un(e)? autre$",
  "^(añadir|agregar)( otro| otra)?$", "^adicionar( outro| outra)?$", "^aggiungi( altro| altra)?$",
  "^toevoegen$", "^nog een toevoegen$", "^dodaj( kolejny| następny)?$", "^追加$", "^添加$",
]);

export const DELETE_TEXT_RX = rx([
  "^(delete|remove)$", "^(löschen|entfernen)$", "^supprimer$", "^(eliminar|borrar|quitar)$", "^(excluir|remover)$",
  "^(elimina|rimuovi)$", "^(verwijderen)$", "^usuń$", "^削除$", "^删除$",
]);

export const SIGN_IN_TEXT_RX = rx(["^sign in$", "^anmelden$", "^se connecter$", "^connexion$", "^iniciar sesión$", "^entrar$", "^accedi$", "^inloggen$", "^aanmelden$", "^zaloguj( się)?$", "^サインイン$", "^登录$", "already have an account", "bereits ein konto", "déjà un compte", "ya tienes una cuenta", "já tem uma conta"]);
export const CREATE_ACCOUNT_TEXT_RX = rx(["create account", "sign up", "register", "konto erstellen", "registrieren", "créer un compte", "crear (una )?cuenta", "criar conta", "crea (un )?account", "account aanmaken", "utwórz konto", "アカウントを作成", "创建帐户", "创建账户"]);
export const SIGN_IN_WITH_EMAIL_RX = rx(["sign in with email", "mit e-mail anmelden", "se connecter avec (une adresse )?e-?mail", "iniciar sesión con (el )?correo", "entrar com e-?mail", "accedi con e-?mail", "inloggen met e-?mail", "zaloguj się (przez|za pomocą) e-?mail"]);

/* ---------------- status texts ---------------- */

export const SUBMITTED_RX = rx([
  "application (has been |was )?(successfully )?submitted", "thank you for (applying|your application)", "you have applied",
  "bewerbung (wurde )?(erfolgreich )?(eingereicht|übermittelt|gesendet)", "vielen dank für ihre bewerbung",
  "candidature (a été )?(envoyée|soumise|transmise)", "merci (pour|de) votre candidature",
  "solicitud (ha sido )?(enviada|presentada)", "gracias por (tu|su) (solicitud|candidatura)",
  "candidatura (foi )?(enviada|submetida)", "obrigad[oa] pela sua candidatura",
  "candidatura (è stata )?(inviata|presentata)", "grazie per (la tua|la sua) candidatura",
  "sollicitatie (is )?(verzonden|ingediend)", "bedankt voor je sollicitatie", "bedankt voor uw sollicitatie",
  "aplikacja (została )?(wysłana|przesłana)", "dziękujemy za (twoją )?aplikację",
  "応募が完了", "ご応募ありがとう", "申请已提交", "感谢您的申请",
]);

export const VERIFY_EMAIL_RX = rx([
  "verify your (email|account)", "verification (email|link)", "check your (email|inbox)", "activate your account",
  "e-?mail(-adresse)? (bestätigen|verifizieren)", "bestätigungs-?e-?mail", "konto aktivieren",
  "vérifiez votre (adresse )?e-?mail", "e-?mail de vérification", "activer votre compte",
  "verifica (tu|su) correo", "correo de verificación", "activa(r)? (tu|su) cuenta",
  "verifique (seu|o seu) e-?mail", "e-?mail de verificação",
  "verifica (il tuo|la tua) (e-?mail|indirizzo)", "e-?mail di verifica",
  "bevestig je e-?mail", "verificatie-?e-?mail",
  "zweryfikuj (swój )?(adres )?e-?mail",
  "メールアドレスを確認", "验证您的电子邮件",
]);

export const AUTH_FAILED_RX = rx([
  "invalid", "incorrect", "wrong", "not recogni[sz]ed", "doesn'?t match", "does not match", "failed",
  "ungültig", "falsch", "fehlgeschlagen", "stimmt nicht",
  "invalide", "incorrect", "erroné", "échec",
  "inválid", "incorrect", "erróne",
  "inválid", "incorret",
  "non (è )?valid", "errat", "non corrett",
  "ongeldig", "onjuist", "mislukt",
  "nieprawidłow", "błędn",
  "無効", "正しくありません", "无效", "错误",
]);

export const ACCOUNT_EXISTS_RX = rx([
  "already (exists|in use|registered|associated)", "account exists",
  "existiert bereits", "bereits (vorhanden|registriert|verwendet)",
  "existe déjà", "déjà (utilisé|enregistré)",
  "ya existe", "ya (está )?(registrad|en uso)",
  "já existe", "já (está )?(registrad|em uso)",
  "esiste già", "già (registrat|in uso)",
  "bestaat al", "al (geregistreerd|in gebruik)",
  "już istnieje",
  "既に存在", "已存在",
]);

export const LOCKED_RX = rx(["lock", "gesperrt", "verrouillé", "bloquead", "bloccat", "geblokkeerd", "zablokowan", "ロック", "锁定"]);

/* ---------------- step names ---------------- */

export const STEP_PATTERNS: [RegExp, string][] = [
  [rx(["self.?identif", "disabilit", "selbstidentifi", "behinderung", "auto-?identification", "handicap", "autoidentificación", "discapacidad", "autoidentificação", "deficiência", "autoidentificazione", "disabilità", "zelfidentificatie", "handicap", "niepełnosprawn", "障害", "残疾"]), "selfIdentify"],
  [rx(["voluntary", "disclosure", "equal (employment )?opportunit", "\\beeo\\b", "diversity", "freiwillige angaben", "chancengleichheit", "informations facultatives", "déclarations volontaires", "divulgaciones voluntarias", "información voluntaria", "divulgações voluntárias", "informações voluntárias", "dichiarazioni volontarie", "informazioni facoltative", "vrijwillige", "dobrowolne", "任意", "自愿"]), "voluntaryDisclosures"],
  [rx(["review", "überprüfen", "prüfen", "zusammenfassung", "vérifier", "révision", "récapitulatif", "revisar", "revisión", "resumen", "revisão", "rivedi", "revisione", "riepilogo", "controleren", "beoordelen", "overzicht", "przegląd", "podsumowanie", "確認", "审核", "检查"]), "review"],
  [rx(["my information", "personal (information|details)", "contact (information|details)", "meine (informationen|angaben|daten)", "persönliche (angaben|daten|informationen)", "mes informations", "informations personnelles", "mi información", "información personal", "datos personales", "minhas informações", "informações pessoais", "le mie informazioni", "informazioni personali", "mijn gegevens", "persoonlijke gegevens", "moje informacje", "dane osobowe", "個人情報", "マイ情報", "我的信息", "个人信息"]), "myInformation"],
  [rx(["my experience", "experience", "work history", "resume", "\\bcv\\b", "meine (erfahrung|berufserfahrung)", "erfahrung", "lebenslauf", "mon expérience", "expérience", "mi experiencia", "experiencia", "currículum", "minha experiência", "experiência", "currículo", "la mia esperienza", "esperienza", "mijn ervaring", "ervaring", "moje doświadczenie", "doświadczenie", "職歴", "経験", "我的经历", "经历", "经验"]), "myExperience"],
  [rx(["question", "additional information", "screening", "application details", "fragen", "bewerbungsfragen", "zusätzliche informationen", "questions", "informations complémentaires", "preguntas", "información adicional", "perguntas", "informações adicionais", "domande", "informazioni aggiuntive", "vragen", "aanvullende informatie", "pytania", "dodatkowe informacje", "質問", "问题"]), "questions"],
];

/* ---------------- option normalisation ---------------- */

/** Localised option words → canonical English, applied before fuzzy matching. */
export const OPTION_SYNONYMS: [RegExp, string][] = [
  [/^(ja|oui|si|sí|sim|sì|tak|はい|是)$/iu, "yes"],
  [/^(nein|non|não|nao|nee|nie|いいえ|否)$/iu, "no"],
  [/\b(mobil|mobiltelefon|handy|portable|móvil|movil|celular|cellulare|mobiel|komórkowy|携帯|手机)\b/giu, "mobile"],
  [/\b(festnetz|fixe|fijo|fixo|fisso|vast|stacjonarny)\b/giu, "landline"],
];

export const COUNTRY_ALIASES: Record<string, string[]> = {
  "united kingdom": ["vereinigtes königreich", "vereinigten königreich", "großbritannien", "großbritannien", "royaume-uni", "reino unido", "regno unito", "verenigd koninkrijk", "wielka brytania", "イギリス", "英国"],
  "united states": ["vereinigte staaten von amerika", "vereinigten staaten", "vereinigte staaten", "usa", "états-unis", "etats-unis", "estados unidos", "stati uniti", "verenigde staten", "stany zjednoczone", "アメリカ", "美国"],
  germany: ["deutschland", "allemagne", "alemania", "alemanha", "germania", "duitsland", "niemcy", "ドイツ", "德国"],
  france: ["frankreich", "francia", "frança", "frankrijk", "francja", "フランス", "法国"],
  spain: ["spanien", "espagne", "españa", "espanha", "spagna", "spanje", "hiszpania", "スペイン", "西班牙"],
  italy: ["italien", "italie", "italia", "itália", "italië", "włochy", "イタリア", "意大利"],
  netherlands: ["niederlande", "pays-bas", "países bajos", "países baixos", "paesi bassi", "nederland", "holandia", "オランダ", "荷兰"],
  ireland: ["irland", "irlande", "irlanda", "ierland", "irlandia", "アイルランド", "爱尔兰"],
  switzerland: ["schweiz", "suisse", "suiza", "suíça", "svizzera", "zwitserland", "szwajcaria", "スイス", "瑞士"],
  austria: ["österreich", "autriche", "áustria", "oostenrijk", "オーストリア", "奥地利"],
  belgium: ["belgien", "belgique", "bélgica", "belgio", "belgië", "belgia", "ベルギー", "比利时"],
  portugal: ["portogallo", "portugalia", "ポルトガル", "葡萄牙"],
  poland: ["polen", "pologne", "polonia", "polônia", "polska", "ポーランド", "波兰"],
  canada: ["kanada", "canadá", "カナダ", "加拿大"],
  mexico: ["mexiko", "mexique", "méxico", "messico", "meksyk", "メキシコ", "墨西哥"],
  brazil: ["brasilien", "brésil", "brasil", "brasile", "brazilië", "brazylia", "ブラジル", "巴西"],
  india: ["indien", "inde", "índia", "indie", "インド", "印度"],
  japan: ["japon", "japón", "japão", "giappone", "japonia", "日本"],
  china: ["chine", "cina", "chiny", "中国"],
  sweden: ["schweden", "suède", "suecia", "suécia", "svezia", "zweden", "szwecja", "スウェーデン", "瑞典"],
  denmark: ["dänemark", "danemark", "dinamarca", "danimarca", "denemarken", "dania", "デンマーク", "丹麦"],
  norway: ["norwegen", "norvège", "noruega", "norvegia", "noorwegen", "norwegia", "ノルウェー", "挪威"],
  australia: ["australien", "australie", "austrália", "australië", "オーストラリア", "澳大利亚"],
  singapore: ["singapur", "singapour", "cingapura", "シンガポール", "新加坡"],
};

/* ---------------- EEO decline ---------------- */

export const DECLINE_RX = rx([
  "decline", "not wish", "prefer not", "don'?t wish", "do not want", "choose not", "not to (answer|disclose|self.?identify)", "rather not",
  "keine angabe", "möchte (ich )?(keine angabe|nicht)", "nicht angeben", "ohne angabe",
  "ne (souhaite|veux|désire) pas", "préfère ne pas", "ne pas (répondre|divulguer)",
  "prefiero no", "no deseo", "no quiero", "no (responder|contestar)",
  "prefiro não", "não desejo", "não quero", "não (responder|informar)",
  "preferisco non", "non desidero", "non voglio", "non rispondere",
  "wil (ik )?(niet|liever niet)", "zeg ik liever niet", "niet (beantwoorden|opgeven)",
  "wolę nie", "nie chcę", "odmawiam",
  "回答しない", "回答を控え", "不愿", "不想回答",
]);

/* ---------------- question labels (answer rules) ---------------- */

export const Q = {
  sponsorship: rx(["sponsor", "visa", "work permit", "immigration", "arbeitserlaubnis", "visum", "aufenthaltstitel", "parrainage", "permis de travail", "patrocinio", "permiso de trabajo", "patrocínio", "autorização de trabalho", "sponsorizzazione", "permesso di lavoro", "werkvergunning", "pozwolenie na pracę", "ビザ", "签证"]),
  authorized: rx(["authori[sz]ed", "eligible to work", "right to work", "legally (able|permitted|entitled)", "work in .* without", "berechtigt", "arbeitsberechtigung", "arbeiten zu dürfen", "autorisé", "droit de travailler", "autorizad[oa]", "derecho a trabajar", "permiso legal", "autorizzat[oa]", "diritto di lavorare", "bevoegd", "recht om te werken", "uprawnion", "prawo do pracy", "就労資格", "工作许可", "合法工作"]),
  adult: rx(["(at least|over|older than) 18", "age of 18", "18 years", "legal (working )?age", "18 jahre", "volljährig", "18 ans", "majeur", "18 años", "mayor de edad", "18 anos", "maior de idade", "18 anni", "maggiorenne", "18 jaar", "meerderjarig", "18 lat", "pełnoletni", "18歳", "18岁"]),
  salary: rx(["salary", "compensation", "pay expectation", "desired (pay|rate)", "expected (pay|rate)", "gehalt", "vergütung", "salaire", "rémunération", "salario", "sueldo", "remuneración", "salário", "remuneração", "stipendio", "retribuzione", "\\bral\\b", "salaris", "wynagrodzeni", "給与", "年収", "薪资", "薪酬"]),
  notice: rx(["notice period", "kündigungsfrist", "préavis", "período de preaviso", "plazo de preaviso", "aviso prévio", "preavviso", "opzegtermijn", "okres wypowiedzenia", "退職までの期間", "通知期"]),
  startDate: rx(["start date", "available to start", "earliest.*start", "availability date", "when can you start", "eintrittstermin", "frühest", "verfügbar ab", "date de début", "disponibilité", "fecha de (inicio|incorporación)", "disponibilidad", "data de início", "disponibilidade", "data di inizio", "disponibilità", "startdatum", "beschikbaar", "data rozpoczęcia", "dostępność", "入社可能日", "开始日期", "到岗"]),
  relocate: rx(["relocat", "umzug", "umziehen", "relocalis", "déménag", "reubica", "traslad", "realoca", "mudar", "trasferi", "verhuiz", "relokac", "przeprowadz", "転居", "搬迁"]),
  hybrid: rx(["hybrid", "hybride", "híbrid", "ibrid", "hybrydow", "ハイブリッド", "混合"]),
  onsite: rx(["on-?site", "in (the )?office", "commut", "vor ort", "im büro", "sur site", "au bureau", "presencial", "en (la )?oficina", "no escritório", "in sede", "in ufficio", "op kantoor", "op locatie", "w biurze", "stacjonarn", "出社", "现场"]),
  previouslyWorked: rx(["previously (been )?(worked|employed)", "former (employee|worker)", "worked (for|at) .* (before|previously)", "current or former", "ever worked for", "bereits (bei|für) .* (gearbeitet|tätig)", "ehemalige", "früher .* (beschäftigt|gearbeitet)", "déjà travaillé", "ancien (employé|salarié)", "trabajado anteriormente", "trabajado (antes|previamente)", "ex ?emplead", "trabalhou anteriormente", "ex-?funcionári", "lavorato in precedenza", "ex dipendente", "eerder gewerkt", "voormalig", "wcześniej pracował", "były pracownik", "以前.*勤務", "曾经.*工作"]),
  source: rx(["how did you hear", "referral source", "^source$", "wie haben sie .* erfahren", "wie sind sie auf", "^quelle$", "comment avez-vous (connu|entendu)", "cómo (te enteraste|se enteró|supiste)", "fuente", "como (soube|ficou sabendo)", "fonte", "come (hai|ha) saputo", "come sei venuto", "hoe (heb je|bent u) .* (gehoord|gevonden)", "bron", "jak dowiedział", "źródło", "どこで知り", "如何得知", "来源"]),
  linkedin: /linkedin/iu,
  github: /github/iu,
  website: rx(["website", "portfolio", "personal url", "webseite", "site (web|internet)", "sitio web", "página web", "sito web", "persoonlijke website", "strona (www|internetowa)", "ウェブサイト", "网站", "作品集"]),
  coverLetter: rx(["cover letter", "why (do you want|are you interested)", "motivation", "tell us why", "anschreiben", "motivationsschreiben", "warum möchten sie", "lettre de motivation", "pourquoi (souhaitez|voulez)", "carta de (presentación|motivación)", "por qué (quieres|desea)", "carta de apresentação", "por que (você )?(quer|deseja)", "lettera (di )?(presentazione|motivazione)", "perché (vuoi|desidera)", "motivatiebrief", "sollicitatiebrief", "waarom wil", "list motywacyjny", "dlaczego chcesz", "志望動機", "求职信", "为什么"]),
  years: rx(["years? of (relevant |professional |work )?experience", "how many years", "jahre (an |berufs)?erfahrung", "wie viele jahre", "années d'expérience", "combien d'années", "años de experiencia", "cuántos años", "anos de experiência", "quantos anos", "anni di esperienza", "quanti anni", "jaar (werk)?ervaring", "hoeveel jaar", "lat doświadczenia", "ile lat", "経験年数", "何年", "年经验", "几年"]),
  firstName: rx(["^(legal )?first name", "given name", "^vorname", "^prénom", "^nombre( de pila)?$", "^(primeiro )?nome$", "^nome( di battesimo)?$", "^voornaam", "^imię", "^名$", "^名字"]),
  lastName: rx(["^(legal )?last name", "family name", "surname", "^nachname", "^familienname", "^nom( de famille)?$", "^apellido", "^sobrenome", "^cognome", "^achternaam", "^nazwisko", "^姓$", "^姓氏"]),
  fullName: rx(["full (legal )?name", "^name$", "your name", "vollständiger name", "nom complet", "nombre completo", "nome completo", "volledige naam", "imię i nazwisko", "氏名", "全名"]),
  email: rx(["e-?mail", "correo", "courriel", "メール", "邮箱", "电子邮件"]),
  phone: rx(["phone", "mobile", "telephone", "telefon", "téléphone", "teléfono", "telefone", "telefono", "telefoon", "電話", "电话"]),
  address1: rx(["address line 1", "street", "straße", "adresse ligne 1", "^rue", "dirección (línea )?1", "calle", "endereço", "rua", "indirizzo", "adresregel 1", "straat", "ulica", "住所", "地址"]),
  city: rx(["^city", "town", "^stadt", "^ort$", "^ville", "^ciudad", "^cidade", "^città", "^plaats", "^stad", "^miasto", "市区町村", "城市"]),
  postal: rx(["postal", "zip", "post ?code", "postleitzahl", "^plz", "code postal", "código postal", "codice postale", "cap$", "postcode", "kod pocztowy", "郵便番号", "邮编"]),
  country: rx(["^country", "^land$", "^pays", "^país", "^paese", "^kraj", "^国", "^国家"]),
  region: rx(["\\bstate\\b", "province", "county", "region", "bundesland", "^région", "département", "provincia", "^estado$", "estado/provincia", "comunidad", "regione", "provincie", "województwo", "都道府県", "省"]),
  gender: rx(["gender", "^sex$", "geschlecht", "genre", "sexe", "género", "sexo", "gênero", "genere", "geslacht", "płeć", "性別", "性别"]),
  hispanic: rx(["hispanic", "latino", "hispano", "hispânico"]),
  ethnicity: rx(["ethnic", "race", "ethnie", "herkunft", "origine ethnique", "etnia", "raza", "raça", "etnicità", "etniciteit", "pochodzenie", "人種", "民族"]),
  veteran: rx(["veteran", "military", "militär", "vétéran", "militaire", "veterano", "militar", "militare", "veteraan", "weteran", "退役軍人", "退伍"]),
  disability: rx(["disabilit", "behinderung", "handicap", "discapacidad", "deficiência", "disabilità", "beperking", "niepełnosprawn", "障害", "残疾"]),
};

/** Sensitive questions — never auto-answered except from the user's own saved answer. */
export const SENSITIVE_RX = rx([
  "convict", "criminal", "felony", "misdemeanou?r", "offen[cs]e", "arrest", "non-?compete", "non-?solicit", "restrictive covenant",
  "relative", "related to", "family member", "conflict of interest", "government official", "politically exposed", "attest", "certify",
  "acknowledge", "e-?signature", "signature", "drug test", "background check consent", "terminated", "dismissed", "disciplin",
  "vorstraf", "strafrechtlich", "verurteilt", "wettbewerbsverbot", "verwandt", "interessenkonflikt", "bestätige", "unterschrift", "gekündigt",
  "casier judiciaire", "condamn", "non-concurrence", "lien de parenté", "conflit d'intérêts", "certifie", "licencié",
  "antecedentes penales", "condenad", "no competencia", "pariente", "conflicto de interés", "certifico", "firma (electrónica|digital)", "su firma", "despedid",
  "antecedentes criminais", "condenad", "não concorrência", "parente", "conflito de interesse", "assinatura", "demitid",
  "precedenti penali", "condannat", "non concorrenza", "parenti", "conflitto di interess", "la (sua|tua) firma", "licenziat",
  "strafblad", "veroordeeld", "concurrentiebeding", "familielid", "belangenconflict", "verklaar", "handtekening", "ontslagen",
  "karaln", "skazan", "zakaz konkurencji", "krewn", "konflikt interesów", "oświadczam", "podpis", "zwolnion",
  "犯罪", "有罪", "競業", "親族", "利益相反", "署名", "犯罪记录", "竞业", "亲属", "利益冲突", "签名",
]);

/* ---------------- language detection ---------------- */

const LANG_HINTS: Record<string, string[]> = {
  en: ["the", "and", "you", "with", "our", "will", "for", "experience", "team"],
  de: ["und", "der", "die", "das", "mit", "für", "sie", "wir", "erfahrung", "kenntnisse"],
  fr: ["et", "les", "des", "vous", "avec", "pour", "nous", "une", "expérience", "équipe"],
  es: ["y", "los", "las", "con", "para", "una", "experiencia", "equipo", "nuestro", "conocimientos"],
  pt: ["e", "os", "as", "com", "para", "uma", "experiência", "equipe", "você", "conhecimento"],
  it: ["e", "il", "di", "con", "per", "una", "esperienza", "team", "nostro", "conoscenza"],
  nl: ["en", "de", "het", "met", "voor", "een", "ervaring", "wij", "jij", "kennis"],
  pl: ["i", "w", "z", "na", "dla", "doświadczenie", "zespół", "oraz", "wiedza", "jesteś"],
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", de: "German", fr: "French", es: "Spanish", pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish", ja: "Japanese", zh: "Chinese",
};

/** Best-guess language code of a text (job description). */
export function detectLanguage(text: string): string {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if ((text.match(/[一-鿿]/g) ?? []).length > 30) return "zh";
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  let best = "en";
  let bestScore = 0;
  for (const [lang, hints] of Object.entries(LANG_HINTS)) {
    const score = hints.reduce((s, h) => s + (freq.get(h) ?? 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

/** Language code from a Workday URL locale (/de-DE/…) if present. */
export function urlLanguage(path: string): string | null {
  const m = path.match(/^\/([a-z]{2})(?:-[A-Z]{2})?\//);
  return m ? m[1] : null;
}

export const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have in is it its of on or our that the their this to we will with you your who what when where which while within without about across after all also any can etc into more most not other over such than them then there these they through under up using use used via was were work working role team teams experience years year strong ability skills skill including include well new must should would may able help ensure based both each " +
    "und der die das den dem des ein eine einer eines mit für von zu auf im in ist sind wir sie ihr ihre unser unsere oder als auch bei aus nach über sowie werden wird haben hat sein erfahrung kenntnisse team aufgaben profil " +
    "et le la les des du de un une avec pour par sur dans est sont nous vous votre notre ou en au aux ainsi que qui être avoir expérience équipe poste profil " +
    "y el la los las de del un una con para por en es son nuestro nuestra tu su o que como más experiencia equipo puesto perfil " +
    "e o a os as de do da dos das um uma com para por em é são nosso nossa você seu sua ou que como mais experiência equipe vaga perfil " +
    "e il lo la i gli le di del della un una con per in è sono nostro nostra tu tuo o che come più esperienza team ruolo profilo " +
    "en de het een met voor van in op is zijn wij jij je jouw onze of als ook bij uit naar over ervaring team functie profiel " +
    "i w z na dla do od jest są my ty twój nasz oraz lub jak także doświadczenie zespół stanowisko profil"
  ).split(/\s+/)
);
