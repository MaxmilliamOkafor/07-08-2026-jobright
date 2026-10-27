/* ua-wd-engine.js — your Workday engine, built from workday-engine/ (npm run build). Do not edit here. */
(() => {
  // src/workday/i18n.ts
  var rx = (parts, flags = "iu") => new RegExp(parts.join("|"), flags);
  var SUBMIT_RX = rx([
    "submit",
    "send application",
    "absenden",
    "einreichen",
    "bewerbung (senden|abschicken)",
    "abschicken",
    "soumettre",
    "envoyer( (ma|la) candidature)?",
    "enviar( (mi|la) (solicitud|candidatura))?",
    "presentar( (mi|la) (solicitud|candidatura))?",
    "submeter",
    "enviar candidatura",
    "invia(re)?( (la )?candidatura)?",
    "verzenden",
    "indienen",
    "versturen",
    "wyślij",
    "prześlij",
    "złóż aplikację",
    "送信",
    "提出",
    "応募する",
    "提交",
    "递交",
    "提交申请"
  ]);
  var NEXT_TEXT_RX = rx([
    "^(save and continue|next|continue)$",
    "^(speichern und (fortfahren|weiter)|weiter|fortfahren)$",
    "^(enregistrer et continuer|suivant|continuer)$",
    "^(guardar y continuar|siguiente|continuar)$",
    "^(salvar e continuar|próximo|avançar|continuar)$",
    "^(salva e continua|avanti|continua)$",
    "^(opslaan en doorgaan|volgende|doorgaan)$",
    "^(zapisz i kontynuuj|dalej|kontynuuj)$",
    "^(保存して続行|次へ|続行|保存并继续|下一步|继续)$"
  ]);
  var APPLY_TEXT_RX = rx([
    "^apply( now)?$",
    "^jetzt bewerben$",
    "^bewerben$",
    "^postuler$",
    "^postuler maintenant$",
    "^(postularme|postular|postularse|aplicar|solicitar)( ahora)?$",
    "^candidatar(-se)?$",
    "^candidati$",
    "^candidarsi$",
    "^solliciteren$",
    "^nu solliciteren$",
    "^aplikuj$",
    "^aplikuj teraz$",
    "^応募する$",
    "^応募$",
    "^申请$",
    "^立即申请$"
  ]);
  var ADD_TEXT_RX = rx([
    "^add( another)?$",
    "^hinzufügen$",
    "^weitere hinzufügen$",
    "^ajouter$",
    "^ajouter un(e)? autre$",
    "^(añadir|agregar)( otro| otra)?$",
    "^adicionar( outro| outra)?$",
    "^aggiungi( altro| altra)?$",
    "^toevoegen$",
    "^nog een toevoegen$",
    "^dodaj( kolejny| następny)?$",
    "^追加$",
    "^添加$"
  ]);
  var DELETE_TEXT_RX = rx([
    "^(delete|remove)$",
    "^(löschen|entfernen)$",
    "^supprimer$",
    "^(eliminar|borrar|quitar)$",
    "^(excluir|remover)$",
    "^(elimina|rimuovi)$",
    "^(verwijderen)$",
    "^usuń$",
    "^削除$",
    "^删除$"
  ]);
  var SIGN_IN_TEXT_RX = rx(["^sign in$", "^anmelden$", "^se connecter$", "^connexion$", "^iniciar sesión$", "^entrar$", "^accedi$", "^inloggen$", "^aanmelden$", "^zaloguj( się)?$", "^サインイン$", "^登录$", "already have an account", "bereits ein konto", "déjà un compte", "ya tienes una cuenta", "já tem uma conta"]);
  var CREATE_ACCOUNT_TEXT_RX = rx(["create account", "sign up", "register", "konto erstellen", "registrieren", "créer un compte", "crear (una )?cuenta", "criar conta", "crea (un )?account", "account aanmaken", "utwórz konto", "アカウントを作成", "创建帐户", "创建账户"]);
  var SIGN_IN_WITH_EMAIL_RX = rx(["sign in with email", "mit e-mail anmelden", "se connecter avec (une adresse )?e-?mail", "iniciar sesión con (el )?correo", "entrar com e-?mail", "accedi con e-?mail", "inloggen met e-?mail", "zaloguj się (przez|za pomocą) e-?mail"]);
  var SUBMITTED_RX = rx([
    "application (has been |was )?(successfully )?submitted",
    "thank you for (applying|your application)",
    "you have applied",
    "bewerbung (wurde )?(erfolgreich )?(eingereicht|übermittelt|gesendet)",
    "vielen dank für ihre bewerbung",
    "candidature (a été )?(envoyée|soumise|transmise)",
    "merci (pour|de) votre candidature",
    "solicitud (ha sido )?(enviada|presentada)",
    "gracias por (tu|su) (solicitud|candidatura)",
    "candidatura (foi )?(enviada|submetida)",
    "obrigad[oa] pela sua candidatura",
    "candidatura (è stata )?(inviata|presentata)",
    "grazie per (la tua|la sua) candidatura",
    "sollicitatie (is )?(verzonden|ingediend)",
    "bedankt voor je sollicitatie",
    "bedankt voor uw sollicitatie",
    "aplikacja (została )?(wysłana|przesłana)",
    "dziękujemy za (twoją )?aplikację",
    "応募が完了",
    "ご応募ありがとう",
    "申请已提交",
    "感谢您的申请"
  ]);
  var ALREADY_APPLIED_RX = rx([
    "you(?:'ve|’ve| have) already applied",
    "already applied (for|to) this (job|position|role)",
    "already submitted an application",
    "sie haben sich bereits (auf diese stelle )?beworben",
    "vous avez déjà postulé",
    "ya (te|se) (has|ha) postulado",
    "ya has aplicado",
    "você já se candidatou",
    "ti sei già candidato",
    "u heeft al gesolliciteerd",
    "je hebt al gesolliciteerd",
    "już aplikowałeś"
  ]);
  var SOMETHING_WRONG_RX = rx([
    "something went wrong\\.? please refresh",
    "something went wrong\\.? please try again",
    "etwas ist schiefgelaufen",
    "une erreur s'est produite\\.? veuillez actualiser",
    "algo salió mal",
    "algo deu errado",
    "qualcosa è andato storto",
    "er is iets misgegaan",
    "coś poszło nie tak"
  ]);
  var VERIFY_EMAIL_RX = rx([
    "verify your (email|account)",
    "verification (email|link)",
    "check your (email|inbox)",
    "activate your account",
    "e-?mail(-adresse)? (bestätigen|verifizieren)",
    "bestätigungs-?e-?mail",
    "konto aktivieren",
    "vérifiez votre (adresse )?e-?mail",
    "e-?mail de vérification",
    "activer votre compte",
    "verifica (tu|su) correo",
    "correo de verificación",
    "activa(r)? (tu|su) cuenta",
    "verifique (seu|o seu) e-?mail",
    "e-?mail de verificação",
    "verifica (il tuo|la tua) (e-?mail|indirizzo)",
    "e-?mail di verifica",
    "bevestig je e-?mail",
    "verificatie-?e-?mail",
    "zweryfikuj (swój )?(adres )?e-?mail",
    "メールアドレスを確認",
    "验证您的电子邮件"
  ]);
  var AUTH_FAILED_RX = rx([
    "invalid",
    "incorrect",
    "wrong",
    "not recogni[sz]ed",
    "doesn'?t match",
    "does not match",
    "failed",
    "ungültig",
    "falsch",
    "fehlgeschlagen",
    "stimmt nicht",
    "invalide",
    "incorrect",
    "erroné",
    "échec",
    "inválid",
    "incorrect",
    "erróne",
    "inválid",
    "incorret",
    "non (è )?valid",
    "errat",
    "non corrett",
    "ongeldig",
    "onjuist",
    "mislukt",
    "nieprawidłow",
    "błędn",
    "無効",
    "正しくありません",
    "无效",
    "错误"
  ]);
  var ACCOUNT_EXISTS_RX = rx([
    "already (exists|in use|registered|associated)",
    "account exists",
    "existiert bereits",
    "bereits (vorhanden|registriert|verwendet)",
    "existe déjà",
    "déjà (utilisé|enregistré)",
    "ya existe",
    "ya (está )?(registrad|en uso)",
    "já existe",
    "já (está )?(registrad|em uso)",
    "esiste già",
    "già (registrat|in uso)",
    "bestaat al",
    "al (geregistreerd|in gebruik)",
    "już istnieje",
    "既に存在",
    "已存在"
  ]);
  var LOCKED_RX = rx(["lock", "gesperrt", "verrouillé", "bloquead", "bloccat", "geblokkeerd", "zablokowan", "ロック", "锁定"]);
  var STEP_PATTERNS = [
    [rx(["self.?identif", "disabilit", "selbstidentifi", "behinderung", "auto-?identification", "handicap", "autoidentificación", "discapacidad", "autoidentificação", "deficiência", "autoidentificazione", "disabilità", "zelfidentificatie", "handicap", "niepełnosprawn", "障害", "残疾"]), "selfIdentify"],
    [rx(["voluntary", "disclosure", "equal (employment )?opportunit", "\\beeo\\b", "diversity", "freiwillige angaben", "chancengleichheit", "informations facultatives", "déclarations volontaires", "divulgaciones voluntarias", "información voluntaria", "divulgações voluntárias", "informações voluntárias", "dichiarazioni volontarie", "informazioni facoltative", "vrijwillige", "dobrowolne", "任意", "自愿"]), "voluntaryDisclosures"],
    [rx(["review", "überprüfen", "prüfen", "zusammenfassung", "vérifier", "révision", "récapitulatif", "revisar", "revisión", "resumen", "revisão", "rivedi", "revisione", "riepilogo", "controleren", "beoordelen", "overzicht", "przegląd", "podsumowanie", "確認", "审核", "检查"]), "review"],
    [rx(["my information", "personal (information|details)", "contact (information|details)", "meine (informationen|angaben|daten)", "persönliche (angaben|daten|informationen)", "mes informations", "informations personnelles", "mi información", "información personal", "datos personales", "minhas informações", "informações pessoais", "le mie informazioni", "informazioni personali", "mijn gegevens", "persoonlijke gegevens", "moje informacje", "dane osobowe", "個人情報", "マイ情報", "我的信息", "个人信息"]), "myInformation"],
    [rx(["my experience", "experience", "work history", "resume", "\\bcv\\b", "meine (erfahrung|berufserfahrung)", "erfahrung", "lebenslauf", "mon expérience", "expérience", "mi experiencia", "experiencia", "currículum", "minha experiência", "experiência", "currículo", "la mia esperienza", "esperienza", "mijn ervaring", "ervaring", "moje doświadczenie", "doświadczenie", "職歴", "経験", "我的经历", "经历", "经验"]), "myExperience"],
    [rx(["question", "additional information", "screening", "application details", "fragen", "bewerbungsfragen", "zusätzliche informationen", "questions", "informations complémentaires", "preguntas", "información adicional", "perguntas", "informações adicionais", "domande", "informazioni aggiuntive", "vragen", "aanvullende informatie", "pytania", "dodatkowe informacje", "質問", "问题"]), "questions"]
  ];
  var OPTION_SYNONYMS = [
    [/^(ja|oui|si|sí|sim|sì|tak|はい|是)$/iu, "yes"],
    [/^(nein|non|não|nao|nee|nie|いいえ|否)$/iu, "no"],
    [/\b(mobil|mobiltelefon|handy|portable|móvil|movil|celular|cellulare|mobiel|komórkowy|携帯|手机)\b/giu, "mobile"],
    [/\b(festnetz|fixe|fijo|fixo|fisso|vast|stacjonarny)\b/giu, "landline"]
  ];
  var COUNTRY_ALIASES = {
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
    singapore: ["singapur", "singapour", "cingapura", "シンガポール", "新加坡"]
  };
  var DECLINE_RX = rx([
    "decline",
    "not wish",
    "prefer not",
    "don'?t wish",
    "do not want",
    "choose not",
    "not to (answer|disclose|self.?identify)",
    "rather not",
    "keine angabe",
    "möchte (ich )?(keine angabe|nicht)",
    "nicht angeben",
    "ohne angabe",
    "ne (souhaite|veux|désire) pas",
    "préfère ne pas",
    "ne pas (répondre|divulguer)",
    "prefiero no",
    "no deseo",
    "no quiero",
    "no (responder|contestar)",
    "prefiro não",
    "não desejo",
    "não quero",
    "não (responder|informar)",
    "preferisco non",
    "non desidero",
    "non voglio",
    "non rispondere",
    "wil (ik )?(niet|liever niet)",
    "zeg ik liever niet",
    "niet (beantwoorden|opgeven)",
    "wolę nie",
    "nie chcę",
    "odmawiam",
    "回答しない",
    "回答を控え",
    "不愿",
    "不想回答"
  ]);
  var Q = {
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
    disability: rx(["disabilit", "behinderung", "handicap", "discapacidad", "deficiência", "disabilità", "beperking", "niepełnosprawn", "障害", "残疾"])
  };
  var SENSITIVE_RX = rx([
    "convict",
    "criminal",
    "felony",
    "misdemeanou?r",
    "offen[cs]e",
    "arrest",
    "non-?compete",
    "non-?solicit",
    "restrictive covenant",
    "relative",
    "related to",
    "family member",
    "conflict of interest",
    "government official",
    "politically exposed",
    "attest",
    "certify",
    "acknowledge",
    "e-?signature",
    "signature",
    "drug test",
    "background check consent",
    "terminated",
    "dismissed",
    "disciplin",
    "vorstraf",
    "strafrechtlich",
    "verurteilt",
    "wettbewerbsverbot",
    "verwandt",
    "interessenkonflikt",
    "bestätige",
    "unterschrift",
    "gekündigt",
    "casier judiciaire",
    "condamn",
    "non-concurrence",
    "lien de parenté",
    "conflit d'intérêts",
    "certifie",
    "licencié",
    "antecedentes penales",
    "condenad",
    "no competencia",
    "pariente",
    "conflicto de interés",
    "certifico",
    "firma (electrónica|digital)",
    "su firma",
    "despedid",
    "antecedentes criminais",
    "condenad",
    "não concorrência",
    "parente",
    "conflito de interesse",
    "assinatura",
    "demitid",
    "precedenti penali",
    "condannat",
    "non concorrenza",
    "parenti",
    "conflitto di interess",
    "la (sua|tua) firma",
    "licenziat",
    "strafblad",
    "veroordeeld",
    "concurrentiebeding",
    "familielid",
    "belangenconflict",
    "verklaar",
    "handtekening",
    "ontslagen",
    "karaln",
    "skazan",
    "zakaz konkurencji",
    "krewn",
    "konflikt interesów",
    "oświadczam",
    "podpis",
    "zwolnion",
    "犯罪",
    "有罪",
    "競業",
    "親族",
    "利益相反",
    "署名",
    "犯罪记录",
    "竞业",
    "亲属",
    "利益冲突",
    "签名"
  ]);
  var LANG_HINTS = {
    en: ["the", "and", "you", "with", "our", "will", "for", "experience", "team"],
    de: ["und", "der", "die", "das", "mit", "für", "sie", "wir", "erfahrung", "kenntnisse"],
    fr: ["et", "les", "des", "vous", "avec", "pour", "nous", "une", "expérience", "équipe"],
    es: ["y", "los", "las", "con", "para", "una", "experiencia", "equipo", "nuestro", "conocimientos"],
    pt: ["e", "os", "as", "com", "para", "uma", "experiência", "equipe", "você", "conhecimento"],
    it: ["e", "il", "di", "con", "per", "una", "esperienza", "team", "nostro", "conoscenza"],
    nl: ["en", "de", "het", "met", "voor", "een", "ervaring", "wij", "jij", "kennis"],
    pl: ["i", "w", "z", "na", "dla", "doświadczenie", "zespół", "oraz", "wiedza", "jesteś"]
  };
  function detectLanguage(text2) {
    if (/[぀-ヿ]/.test(text2)) return "ja";
    if ((text2.match(/[一-鿿]/g) ?? []).length > 30) return "zh";
    const words = text2.toLowerCase().match(new RegExp("\\p{L}+", "gu")) ?? [];
    const freq = /* @__PURE__ */ new Map();
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
  function urlLanguage(path) {
    const m = path.match(/^\/([a-z]{2})(?:-[A-Z]{2})?\//);
    return m ? m[1] : null;
  }
  var STOPWORDS = new Set(
    "a an and are as at be by for from has have in is it its of on or our that the their this to we will with you your who what when where which while within without about across after all also any can etc into more most not other over such than them then there these they through under up using use used via was were work working role team teams experience years year strong ability skills skill including include well new must should would may able help ensure based both each und der die das den dem des ein eine einer eines mit für von zu auf im in ist sind wir sie ihr ihre unser unsere oder als auch bei aus nach über sowie werden wird haben hat sein erfahrung kenntnisse team aufgaben profil et le la les des du de un une avec pour par sur dans est sont nous vous votre notre ou en au aux ainsi que qui être avoir expérience équipe poste profil y el la los las de del un una con para por en es son nuestro nuestra tu su o que como más experiencia equipo puesto perfil e o a os as de do da dos das um uma com para por em é são nosso nossa você seu sua ou que como mais experiência equipe vaga perfil e il lo la i gli le di del della un una con per in è sono nostro nostra tu tuo o che come più esperienza team ruolo profilo en de het een met voor van in op is zijn wij jij je jouw onze of als ook bij uit naar over ervaring team functie profiel i w z na dla do od jest są my ty twój nasz oraz lub jak także doświadczenie zespół stanowisko profil".split(/\s+/)
  );

  // src/workday/selectors.ts
  var AID = {
    // Job posting
    jobTitle: ["jobPostingHeader"],
    jobDescription: ["jobPostingDescription", "job-posting-details"],
    jobLocation: ["locations"],
    jobReqId: ["requisitionId"],
    applyButton: ["adventureButton", "applyButton"],
    // Apply method modal
    autofillWithResume: ["autofillWithResume"],
    applyManually: ["applyManually"],
    useLastApplication: ["useMyLastApplication"],
    // Auth
    signInLink: ["signInLink", "utilityButtonSignIn"],
    createAccountLink: ["createAccountLink"],
    signInWithEmail: ["SignInWithEmailButton", "signInWithEmailButton"],
    email: ["email"],
    password: ["password"],
    verifyPassword: ["verifyPassword"],
    createAccountCheckbox: ["createAccountCheckbox"],
    createAccountSubmit: ["createAccountSubmitButton"],
    signInSubmit: ["signInSubmitButton"],
    clickFilter: ["click_filter"],
    forgotPassword: ["forgotPasswordLink"],
    // Wizard chrome
    progressActive: ["progressBarActiveStep"],
    progressBar: ["progressBar"],
    pageHeader: ["pageHeader"],
    next: ["pageFooterNextButton", "bottom-navigation-next-button", "btnNext", "btnSubmit"],
    back: ["pageFooterBackButton", "bottom-navigation-back-button"],
    errorBanner: ["errorBanner", "errorSection"],
    errorMessage: ["errorMessage", "inputAlert"],
    spinner: ["loadingSpinner", "wd-LoadingPanel"],
    // Generic controls
    searchBox: ["searchBox"],
    promptOption: ["promptOption"],
    promptLeaf: ["promptLeafNode"],
    selectedItem: ["selectedItem", "selectedItemList"],
    fileInput: ["file-upload-input-ref", "select-files"],
    fileUploaded: ["file-upload-successful", "file-upload-item"],
    fileDelete: ["delete-file"],
    addButton: ["add-button", "Add", "addButton", "btnAddWorkHistory", "btnAddEducationHistory"],
    deleteBlock: ["panel-set-delete-button"],
    // My Information
    source: ["sourceDropdown", "formField-sourceDropdown", "formField-source--source"],
    previousWorker: ["previousWorker", "formField-candidateIsPreviousWorker"],
    country: ["countryDropdown", "formField-countryDropdown", "formField-country", "public-site-address-country-input-base"],
    firstName: ["legalNameSection_firstName", "formField-legalName--firstName", "infoFirstName"],
    lastName: ["legalNameSection_lastName", "formField-legalName--lastName", "infoLastName"],
    preferredCheck: ["preferredNameCheckbox", "formField-preferredCheck"],
    preferredFirst: ["preferredNameSection_firstName", "formField-preferredName--firstName", "infoPreferredName"],
    address1: ["addressSection_addressLine1", "formField-address--addressLine1", "public-site-address-address-1"],
    address2: ["addressSection_addressLine2", "formField-address--addressLine2", "public-site-address-address-2"],
    city: ["addressSection_city", "formField-address--city", "public-site-address-city", "public-site-address-locality"],
    region: ["addressSection_countryRegion", "formField-address--countryRegion", "public-site-address-us-state-input-base"],
    postal: ["addressSection_postalCode", "formField-address--postalCode", "public-site-address-postal-code", "public-site-address-zip"],
    phoneType: ["phone-device-type", "formField-phoneNumber--phoneType"],
    phoneCode: ["countryPhoneCode", "formField-phoneNumber--countryPhoneCode"],
    phoneNumber: ["phone-number", "formField-phoneNumber--phoneNumber", "infoCellPhone", "infoPhone"],
    phoneExt: ["phone-extension", "formField-phoneNumber--extension"],
    // My Experience
    workSection: ["workExperienceSection", "workExperience"],
    eduSection: ["educationSection", "education"],
    certSection: ["certificationsSection", "certificationSection", "certifications"],
    langSection: ["languageSection", "languagesSection", "languages"],
    webSection: ["websiteSection", "websitePanelSet", "websites"],
    skills: ["formField-skills", "skillsSection"],
    linkedin: ["linkedinQuestion", "formField-linkedInAccount", "infoLinkedIn"],
    jobTitleF: ["jobTitle", "formField-jobTitle", "workHistoryPosition"],
    companyF: ["company", "formField-companyName", "workHistoryCompanyName"],
    locationF: ["location", "formField-location"],
    currentlyF: ["currentlyWorkHere", "formField-currentlyWorkHere"],
    descriptionF: ["description", "formField-roleDescription"],
    startDateF: ["formField-startDate", "formField-firstYearAttended"],
    endDateF: ["formField-endDate", "formField-lastYearAttended"],
    schoolF: ["school", "formField-schoolName", "formField-school", "formField-schoolItem", "educationHistoryName"],
    degreeF: ["degree", "formField-degree"],
    fieldF: ["fieldOfStudy", "formField-fieldOfStudy", "formField-field-of-study", "educationHistoryAreaOfStudy"],
    gpaF: ["gradeAverage", "formField-gradeAverage", "educationHistoryGpa"],
    certNameF: ["certification", "formField-certification"],
    langF: ["language", "formField-language"],
    nativeF: ["nativeLanguage", "formField-nativeLanguage"],
    urlF: ["url", "formField-url"],
    dateMonth: ["dateSectionMonth-input"],
    dateDay: ["dateSectionDay-input"],
    dateYear: ["dateSectionYear-input"],
    // Questionnaires
    questionnaire: ["primaryQuestionnaire", "secondaryQuestionnaire", "questionnaire", "primaryQuestionnairePage", "secondaryQuestionnairePage"],
    // Voluntary disclosures
    gender: ["gender", "formField-gender"],
    ethnicity: ["ethnicityDropdown", "formField-ethnicity", "formField-ethnicityMulti", "ethnicityMulti-CheckboxGroup", "ethnicityPrompt"],
    hispanic: ["hispanicOrLatino", "formField-hispanicOrLatino"],
    veteran: ["veteranStatus", "formField-veteranStatus"],
    agreement: ["agreementCheckbox", "formField-acceptTermsAndAgreements"],
    // Self identify
    selfIdName: ["name", "formField-name"],
    selfIdDate: ["dateSignedOn", "formField-dateSignedOn"],
    disability: ["selfIdentifiedDisabilityData", "disabilityStatus", "formField-disabilityStatus", "disabilityStatus-CheckboxGroup"],
    // Candidate home
    candidateHome: ["candidateHomePage", "myApplicationsTab"],
    // [oh] Page containers (ids from SpeedyApply): name the step even when a tenant renames it.
    pageAutofill: ["applyFlowAutoFillPage", "quickApplyPage"],
    pageMyInfo: ["applyFlowMyInfoPage", "contactInformationPage"],
    pageMyExp: ["applyFlowMyExpPage", "myExperiencePage"],
    pageQuestions: ["applyFlowPrimaryQuestionsPage", "applyFlowSecondaryQuestionsPage", "applyFlowSupplementaryQuestionsPage", "primaryQuestionnairePage", "secondaryQuestionnairePage"],
    pageVoluntary: ["applyFlowVoluntaryDisclosuresPage", "voluntaryDisclosuresPage"],
    pageSelfId: ["applyFlowSelfIdentifyPage", "selfIdentificationPage"],
    pageReview: ["applyFlowReviewPage", "reviewJobApplicationPage"]
  };
  function sel(key2) {
    return AID[key2].map((id) => `[data-automation-id="${id}"]`).join(",");
  }
  var LABELS = {
    firstName: Q.firstName,
    lastName: Q.lastName,
    address1: Q.address1,
    address2: /address line 2|adresszusatz|complément d'adresse|línea 2|complemento|indirizzo 2|adresregel 2/iu,
    city: Q.city,
    region: Q.region,
    postal: Q.postal,
    phoneNumber: /phone number|mobile number|telephone|telefonnummer|numéro de téléphone|número de teléfono|número de telefone|numero di telefono|telefoonnummer|numer telefonu|電話番号|电话号码/iu,
    phoneType: /phone device type|phone type|gerätetyp|type d'appareil|tipo de (dispositivo|teléfono|telefone)|tipo di (dispositivo|telefono)|apparaattype|typ urządzenia/iu,
    phoneCode: /country phone code|country code|ländervorwahl|landesvorwahl|indicatif|código (de país|do país)|prefisso|landcode|kod kraju/iu,
    country: Q.country,
    source: Q.source,
    previousWorker: Q.previouslyWorked,
    email: Q.email,
    linkedin: Q.linkedin,
    jobTitleF: /job title|position title|berufsbezeichnung|stellenbezeichnung|intitulé du poste|titre du poste|(puesto|cargo)|título del puesto|título do cargo|qualifica|titolo|functietitel|stanowisko|職種|职位/iu,
    companyF: /company|employer|unternehmen|arbeitgeber|firma|entreprise|employeur|empresa|empleador|empregador|azienda|datore|bedrijf|werkgever|pracodawca|会社|公司/iu,
    locationF: /location|standort|ort|lieu|ubicación|localização|località|sede|locatie|lokalizacja|勤務地|地点/iu,
    currentlyF: /currently work here|current(ly)? employ|derzeit|actuellement|actualmente|attualmente|momenteel|obecnie|現在/iu,
    descriptionF: /role description|description|responsibilities|beschreibung|tätigkeit|descripción|descrição|descrizione|omschrijving|opis|職務内容|描述/iu,
    schoolF: /school|university|institution|hochschule|universität|schule|école|université|escuela|universidad|escola|universidade|scuola|università|universiteit|uczelnia|szkoła|学校|大学/iu,
    degreeF: /degree|abschluss|diplôme|título|titulação|grau|titolo di studio|laurea|diploma|graad|stopień|学位/iu,
    fieldF: /field of study|major|discipline|studienfach|fachrichtung|domaine d'études|campo de estudio|área de estudo|campo di studio|studierichting|kierunek|専攻|专业/iu,
    gpaF: /grade|gpa|note|nota|voto|cijfer|ocena|成績|成绩/iu,
    gender: Q.gender,
    ethnicity: Q.ethnicity,
    hispanic: Q.hispanic,
    veteran: Q.veteran,
    selfIdName: /^(name|nom|nombre|nome|naam|imię|氏名|姓名)/iu,
    selfIdDate: /date|datum|fecha|data|日付|日期/iu
  };

  // src/workday/dom.ts
  var Aborted = class extends Error {
    constructor() {
      super("Stopped by user");
    }
  };
  var NeedsHuman = class extends Error {
    constructor(reason, label = "") {
      super(reason);
      this.reason = reason;
      this.label = label;
    }
  };
  var abortFlag = false;
  function setAbort(v) {
    abortFlag = v;
  }
  function checkAbort() {
    if (abortFlag) throw new Aborted();
  }
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms)).then(checkAbort);
  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  function qa(selector, root2 = document) {
    return [...root2.querySelectorAll(selector)];
  }
  function q(selector, root2 = document) {
    return root2.querySelector(selector);
  }
  function byAid(key2, root2 = document) {
    for (const id of AID[key2]) {
      const hit = qa(`[data-automation-id="${id}"]`, root2).find(isVisible);
      if (hit) return hit;
    }
    return null;
  }
  function anyAid(key2, root2 = document) {
    return qa(sel(key2), root2).some(isVisible);
  }
  async function waitFor(fn, timeoutMs = 8e3, everyMs = 100) {
    const start = Date.now();
    for (; ; ) {
      checkAbort();
      const v = fn();
      if (v) return v;
      if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the page");
      await sleep(everyMs);
    }
  }
  async function waitStable(quietMs = 600, timeoutMs = 2e4) {
    const start = Date.now();
    let last = Date.now();
    const obs = new MutationObserver(() => {
      last = Date.now();
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    try {
      for (; ; ) {
        checkAbort();
        const busy = anyAid("spinner") || qa('[role="progressbar"]').some((e) => isVisible(e) && !e.closest(sel("progressBar")));
        if (!busy && Date.now() - last >= quietMs) return;
        if (Date.now() - start > timeoutMs) return;
        await sleep(100);
      }
    } finally {
      obs.disconnect();
    }
  }
  function text(el) {
    return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  function labelOf(el) {
    const container = el.closest('[data-automation-id^="formField-"]') ?? el;
    const legend = container.querySelector("legend, label");
    let t = text(legend);
    if (!t) {
      const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
      t = ids.map((id) => text(document.getElementById(id))).join(" ");
    }
    if (!t) t = el.getAttribute("aria-label") ?? "";
    if (!t && el.id) t = text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    return t.replace(/\*/g, "").trim();
  }
  function isRequired(container) {
    if (/\*/.test(text(container.querySelector("legend, label")))) return true;
    return !!container.querySelector('[aria-required="true"], [required]');
  }
  function field(key2, root2 = document) {
    const hit = byAid(key2, root2);
    if (hit) return hit;
    const rx2 = LABELS[key2];
    if (!rx2) return null;
    for (const c of qa('[data-automation-id^="formField-"]', root2)) {
      if (!isVisible(c)) continue;
      if (rx2.test(labelOf(c))) return c;
    }
    return null;
  }
  async function humanClick(el) {
    checkAbort();
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(60);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let target = document.elementFromPoint(x, y) ?? el;
    const filter = el.parentElement?.querySelector(sel("clickFilter"));
    if (!(el.contains(target) || target === filter)) target = filter && isVisible(filter) ? filter : el;
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new PointerEvent("pointerover", opts));
    target.dispatchEvent(new PointerEvent("pointerdown", opts));
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.focus?.();
    target.dispatchEvent(new PointerEvent("pointerup", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
  }
  function buttonByText(rx2, root2 = document) {
    return qa('button, [role="button"], a', root2).find((b) => isVisible(b) && rx2.test(text(b) || b.getAttribute("aria-label") || "")) ?? null;
  }
  var SYNONYMS = [
    [/\b(usa|u\.s\.a?\.?|united states of america)\b/g, "united states"],
    [/\b(uk|u\.k\.|great britain|britain)\b/g, "united kingdom"],
    [/\bcell( phone)?\b/g, "mobile"],
    [/\b(bachelor'?s?|bsc|b\.sc\.?|ba|b\.a\.?|beng|licence|licenciatura|grado|laurea triennale|licencjat|bacharelado)\b/g, "bachelor"],
    [/\b(master'?s?|msc|m\.sc\.?|ma|m\.a\.?|meng|mba|máster|maîtrise|mestrado|laurea magistrale|magister)\b/g, "master"],
    [/\b(phd|ph\.d\.?|doctorate|doktor|doctorat|doctorado|doutorado|dottorato)\b/g, "doctor"]
  ];
  var COUNTRY_RX = Object.entries(COUNTRY_ALIASES).flatMap(
    ([canon, aliases]) => aliases.map((a) => [new RegExp(`(^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\p{L}]|$)`, "giu"), `$1${canon}`])
  );
  function norm(s) {
    let t = s.toLowerCase().normalize("NFKC").replace(/[’']/g, "'").trim();
    for (const [rx2, rep] of COUNTRY_RX) t = t.replace(rx2, rep);
    for (const [rx2, rep] of OPTION_SYNONYMS) t = t.replace(rx2, rep);
    for (const [rx2, rep] of SYNONYMS) t = t.replace(rx2, rep);
    t = t.normalize("NFD").replace(new RegExp("\\p{M}+", "gu"), "");
    return t.replace(/[^\p{L}\p{N}+ ]+/gu, " ").replace(/\s+/g, " ").trim();
  }
  function similarity(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (y.startsWith(x) || x.startsWith(y)) return 0.92;
    if (y.includes(x) || x.includes(y)) return 0.85;
    const tx = new Set(x.split(" "));
    const ty = new Set(y.split(" "));
    let inter = 0;
    tx.forEach((t) => ty.has(t) && inter++);
    return inter / Math.max(tx.size, ty.size);
  }
  function bestMatch(els, wanted, min = 0.6) {
    let best = null;
    let score = 0;
    for (const el of els) {
      const s = similarity(wanted, text(el));
      if (s > score) {
        score = s;
        best = el;
      }
    }
    return score >= min ? best : null;
  }
  var DECLINE_RX2 = DECLINE_RX;

  // src/workday/controls.ts
  var trustedFallback = false;
  function enableTrustedFallback(v) {
    trustedFallback = v;
  }
  function kindOf(el) {
    if (el.matches('input[type="file"]') || q('input[type="file"]', el)) return "file";
    if (el.matches(sel("dateMonth") + "," + sel("dateYear")) || q(sel("dateYear"), el) || q(sel("dateMonth"), el)) return "date";
    if (q(sel("searchBox"), el) || q('[data-uxi-widget-type="multiselect"]', el) || q(sel("selectedItem"), el)) return "multiselect";
    if (el.matches('button[aria-haspopup="listbox"]') || q('button[aria-haspopup="listbox"]', el)) return "dropdown";
    if (el.matches('input[type="radio"], [role="radio"]') || q('input[type="radio"], [role="radio"]', el)) return "radio";
    const boxes = el.matches('input[type="checkbox"]') ? [el] : qa('input[type="checkbox"], [role="checkbox"]', el);
    if (boxes.length > 1) return "checkboxGroup";
    if (boxes.length === 1) return "checkbox";
    if (el.matches("textarea") || q("textarea", el)) return "textarea";
    if (el.matches("input") || q('input:not([type="hidden"])', el)) return "text";
    return "none";
  }
  function inputIn(el) {
    if (el.matches("input, textarea")) return el;
    return q('textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])', el);
  }
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function blur(el) {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur"));
    el.blur();
  }
  async function trustedType(el, value) {
    if (!trustedFallback) return false;
    el.focus();
    el.select?.();
    const res = await chrome.runtime.sendMessage({ type: "wd:trustedType", text: value });
    return !!res?.ok;
  }
  async function setText(target, value) {
    const el = inputIn(target);
    if (!el || el.disabled || el.readOnly) return false;
    const max = Number(el.getAttribute("maxlength")) || 0;
    const v = max > 0 ? value.slice(0, max) : value;
    if (el.value === v) return true;
    setNativeValue(el, v);
    blur(el);
    await sleep(40);
    if (el.value === v) return true;
    if (await trustedType(el, v)) {
      blur(el);
      await sleep(60);
      return el.value === v;
    }
    return false;
  }
  function openListbox(btn) {
    const ctl = btn?.getAttribute("aria-controls");
    if (ctl) {
      const byId = document.getElementById(ctl);
      if (isVisible(byId) && byId.matches('[role="listbox"]')) return byId;
    }
    const field2 = btn?.closest('[data-automation-id^="formField-"]');
    const local = field2 ? qa('[role="listbox"]', field2).find(isVisible) : null;
    if (local) return local;
    const open = qa('[role="listbox"]').filter(isVisible);
    return open.find((l) => !l.closest('[data-automation-id^="formField-"]') || l.closest('[data-automation-id^="formField-"]') === field2) ?? null;
  }
  async function closeListbox(btn) {
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(80);
    if (openListbox(btn)) {
      await humanClick(btn);
      await sleep(80);
    }
  }
  function dropdownButton(target) {
    return target.matches('button[aria-haspopup="listbox"]') ? target : q('button[aria-haspopup="listbox"]', target);
  }
  function dropdownValue(target) {
    const b = dropdownButton(target);
    const t = text(b);
    return /^select one$|^select$/i.test(t) ? "" : t;
  }
  function key(el, k) {
    const code = k.length === 1 ? /\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}` : k;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: k, code, bubbles: true }));
  }
  function optionIn(list, wanted, min) {
    const opts = qa('[role="option"]', list).filter((o) => text(o) && !/^select one$/i.test(text(o)));
    return wanted === "decline" ? opts.find((o) => DECLINE_RX2.test(text(o))) ?? null : bestMatch(opts, wanted, min);
  }
  async function findInLongList(btn, wanted, min) {
    let list = openListbox(btn);
    if (!list || wanted === "decline") return null;
    const typed = norm(wanted).replace(/[^a-z0-9 ]/g, "").slice(0, 4);
    for (const ch of typed) key(list, ch);
    await sleep(250);
    list = openListbox(btn) ?? list;
    let m = optionIn(list, wanted, min);
    for (let i = 0; !m && i < 40 && list.scrollHeight > list.clientHeight; i++) {
      const before = list.scrollTop;
      list.scrollTop = before + Math.max(120, list.clientHeight - 20);
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(60);
      m = optionIn(list, wanted, min);
      if (list.scrollTop === before) break;
    }
    return m;
  }
  async function selectDropdown(target, wanted, min = 0.6) {
    const btn = dropdownButton(target);
    if (!btn) return false;
    const current = dropdownValue(target);
    if (current && (wanted === "decline" ? DECLINE_RX2.test(current) : similarity(wanted, current) >= 0.92)) return true;
    if (!openListbox(btn)) await humanClick(btn);
    let list = await waitFor(() => openListbox(btn), 4e3).catch(() => null);
    if (!list) {
      btn.focus();
      key(btn, "ArrowDown");
      list = await waitFor(() => openListbox(btn), 2e3).catch(() => null);
    }
    if (!list) return false;
    const match = optionIn(list, wanted, min) ?? await findInLongList(btn, wanted, min);
    if (!match) {
      await closeListbox(btn);
      return false;
    }
    const wantText = text(match);
    match.scrollIntoView?.({ block: "nearest" });
    await humanClick(match);
    await sleep(120);
    await waitStable(250, 4e3);
    if (dropdownValue(target) && similarity(wantText, dropdownValue(target)) >= 0.85) return true;
    if (!openListbox(btn)) {
      btn.focus();
      key(btn, "ArrowDown");
      await waitFor(() => openListbox(btn), 2e3).catch(() => null);
    }
    const l2 = openListbox(btn);
    if (l2) {
      const opts = qa('[role="option"]', l2);
      const idx = opts.findIndex((o) => text(o) === wantText);
      if (idx >= 0) {
        opts[idx].focus?.();
        for (let i = 0; i <= idx; i++) key(document.activeElement instanceof HTMLElement ? document.activeElement : l2, "ArrowDown");
        key(document.activeElement instanceof HTMLElement ? document.activeElement : opts[idx], "Enter");
        await sleep(150);
        await waitStable(250, 4e3);
      } else await closeListbox(btn);
    }
    return !!dropdownValue(target) && similarity(wantText, dropdownValue(target)) >= 0.85;
  }
  function dropdownOptions(btn) {
    const list = openListbox(btn);
    return list ? qa('[role="option"]', list).map(text).filter(Boolean) : [];
  }
  async function readDropdownOptions(target) {
    const btn = dropdownButton(target);
    if (!btn) return [];
    if (!openListbox(btn)) await humanClick(btn);
    await waitFor(() => openListbox(btn), 3e3).catch(() => null);
    const out = dropdownOptions(btn).filter((o) => !/^select one$/i.test(o));
    await closeListbox(btn);
    return out;
  }
  function multiselectSelected(target) {
    return qa(sel("selectedItem"), target).map(text).filter(Boolean);
  }
  function visibleOptions() {
    return qa(sel("promptOption")).filter(isVisible);
  }
  function spinning() {
    return qa(sel("spinner")).some(isVisible) || qa('[data-automation-id*="oading"], [aria-busy="true"]').some(isVisible);
  }
  async function settledOptions(timeout = 6e3) {
    const end = Date.now() + timeout;
    let last = "";
    let stableSince = Date.now();
    while (Date.now() < end) {
      const o = visibleOptions();
      const sig = o.map(text).join("|");
      if (sig !== last) {
        last = sig;
        stableSince = Date.now();
      }
      if (o.length && !spinning() && Date.now() - stableSince >= 300) return o;
      await sleep(100);
    }
    return visibleOptions();
  }
  var MULTI_ALIASES = [
    [/^aws$|amazon web services/i, ["Amazon Web Services (AWS)", "AWS", "Amazon Web Services"]],
    [/^gcp$|google cloud/i, ["Google Cloud Platform (GCP)", "Google Cloud Platform", "GCP"]],
    [/^azure$|microsoft azure/i, ["Microsoft Azure", "Azure"]],
    [/^k8s$|^kubernetes$/i, ["Kubernetes"]],
    [/^js$|^javascript$/i, ["JavaScript"]],
    [/^ts$|^typescript$/i, ["TypeScript"]],
    [/^golang$|^go$/i, ["Go (Programming Language)", "Go", "Golang"]],
    [/^c#$|^csharp$/i, ["C# (Programming Language)", "C#"]],
    [/^c\+\+$/i, ["C++ (Programming Language)", "C++"]],
    [/^ci\/?cd$/i, ["Continuous Integration and Continuous Delivery (CI/CD)", "CI/CD", "Continuous Integration"]],
    [/^ml$|^machine learning$/i, ["Machine Learning"]],
    [/^ai$|^artificial intelligence$/i, ["Artificial Intelligence (AI)", "Artificial Intelligence"]],
    [/^sql$/i, ["SQL (Programming Language)", "SQL"]],
    [/^linkedin$/i, ["LinkedIn", "LinkedIn Jobs", "LinkedIn.com"]]
  ];
  function searchTerms(wanted) {
    const out = [wanted];
    for (const [rx2, alts] of MULTI_ALIASES) if (rx2.test(wanted.trim())) out.push(...alts);
    const first = wanted.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
    if (first && first.length >= 3 && first !== wanted) out.push(first);
    return [...new Set(out)];
  }
  async function multiselectPick(target, wanted, opts = {}) {
    const min = opts.min ?? 0.6;
    if (multiselectSelected(target).some((s) => similarity(wanted, s) >= 0.85)) return true;
    const input = q(sel("searchBox"), target) ?? q("input", target);
    if (!input) return false;
    const path = opts.path?.length ? opts.path : [wanted];
    const terms = opts.noRetry || opts.path ? [path[0]] : searchTerms(wanted);
    const before = multiselectSelected(target).length;
    for (const term of terms) {
      await humanClick(input);
      setNativeValue(input, opts.path ? "" : term);
      if (!opts.path) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      await sleep(250);
      for (let depth = 0; depth < 3; depth++) {
        const options = await settledOptions(depth ? 4e3 : 6e3);
        if (!options.length) break;
        const want = opts.path ? path[Math.min(depth, path.length - 1)] : wanted;
        let match = bestMatch(options, want, min) ?? (term !== wanted ? bestMatch(options, term, Math.max(min, 0.85)) : null);
        if (!match && opts.fallbackFirst && (!opts.path || depth >= path.length - 1)) match = options[0];
        if (!match) break;
        const picked = text(match);
        await humanClick(match);
        await sleep(250);
        if (spinning()) await settledOptions(3e3);
        if (multiselectSelected(target).length > before || multiselectSelected(target).some((s) => similarity(picked, s) >= 0.85)) {
          blur(input);
          return true;
        }
      }
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(80);
    }
    blur(input);
    await sleep(80);
    return multiselectSelected(target).length > before || multiselectSelected(target).some((s) => similarity(wanted, s) >= 0.6);
  }
  function radios(target) {
    return qa('input[type="radio"], [role="radio"]', target);
  }
  function optionLabel(input) {
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l) return text(l);
    }
    return text(input.closest("label")) || input.getAttribute("aria-label") || text(input.parentElement);
  }
  function radioOptions(target) {
    return radios(target).map(optionLabel);
  }
  function radioValue(target) {
    const r = radios(target).find((x) => x.checked || x.getAttribute("aria-checked") === "true");
    return r ? optionLabel(r) : "";
  }
  async function selectRadio(target, wanted) {
    const rs = radios(target);
    let best = null;
    let score = 0;
    for (const r of rs) {
      const l = optionLabel(r);
      const s = wanted === "decline" ? DECLINE_RX2.test(l) ? 1 : 0 : similarity(wanted, l);
      if (s > score) {
        score = s;
        best = r;
      }
    }
    if (!best || score < 0.6) return false;
    if (best.checked) return true;
    await humanClick(best);
    await sleep(80);
    return radioValue(target) === optionLabel(best);
  }
  async function setCheckbox(target, checked) {
    const box = target.matches('input[type="checkbox"], [role="checkbox"]') ? target : q('input[type="checkbox"], [role="checkbox"]', target);
    if (!box) return false;
    const isOn = () => box.checked || box.getAttribute("aria-checked") === "true";
    if (isOn() === checked) return true;
    await humanClick(box);
    await sleep(80);
    return isOn() === checked;
  }
  async function checkInGroup(target, wanted) {
    const boxes = qa('input[type="checkbox"], [role="checkbox"]', target);
    const scored = boxes.map((b) => {
      const l = optionLabel(b);
      return { b, s: wanted === "decline" ? DECLINE_RX2.test(l) ? 1 : 0 : similarity(wanted, l) };
    }).sort((a, b) => b.s - a.s);
    if (!scored[0] || scored[0].s < 0.5) return false;
    return setCheckbox(scored[0].b, true);
  }
  function checkboxGroupOptions(target) {
    return qa('input[type="checkbox"], [role="checkbox"]', target).map(optionLabel);
  }
  async function setSegment(seg, value) {
    const clean = () => (seg.value || seg.getAttribute("aria-valuenow") || "").replace(/^0+/, "");
    const want = value.replace(/^0+/, "");
    if (clean() === want) return true;
    await humanClick(seg);
    for (const ch of value) {
      seg.dispatchEvent(new KeyboardEvent("keydown", { key: ch, code: `Digit${ch}`, bubbles: true }));
      seg.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true }));
      seg.dispatchEvent(new KeyboardEvent("keyup", { key: ch, code: `Digit${ch}`, bubbles: true }));
      await sleep(30);
    }
    if (clean() !== want) setNativeValue(seg, value);
    await sleep(60);
    if (clean() !== want && trustedFallback) {
      seg.focus();
      await chrome.runtime.sendMessage({ type: "wd:trustedType", text: value });
      await sleep(80);
    }
    return clean() === want;
  }
  async function setDate(target, ym2) {
    const [y, m, d] = ym2.split("-");
    const month = q(sel("dateMonth"), target);
    const day = q(sel("dateDay"), target);
    const year = q(sel("dateYear"), target);
    let ok = true;
    if (month && m) ok = await setSegment(month, m) && ok;
    if (day && d) ok = await setSegment(day, d) && ok;
    if (year && y) ok = await setSegment(year, y) && ok;
    if (!month && !year) {
      const input = inputIn(target);
      const masked = !!input && /mm|yyyy|dd/i.test(input.placeholder || input.getAttribute("aria-placeholder") || "");
      const v = [m, d, y].filter(Boolean).join(masked ? "" : "/");
      const done = await setText(target, v);
      if (done && !invalidDate(target)) return true;
      return setText(target, [m, d, y].filter(Boolean).join(masked ? "/" : "")).then((r) => r && !invalidDate(target));
    }
    if (year) blur(year);
    if (ok && invalidDate(target)) {
      if (month && m) {
        setNativeValue(month, "");
        ok = await setSegment(month, m);
      }
      if (year && y) {
        setNativeValue(year, "");
        ok = await setSegment(year, y) && ok;
        blur(year);
      }
      await sleep(80);
      ok = ok && !invalidDate(target);
    }
    return ok;
  }
  function invalidDate(target) {
    const c = target.closest('[data-automation-id^="formField-"]') ?? target;
    return qa(sel("errorMessage"), c).filter(isVisible).some((e) => /invalid date|ungültiges datum|date non valide|date invalide|fecha no válida|fecha inválida|data non valida|data inválida|ongeldige datum|nieprawidłowa data/i.test(text(e)));
  }
  function dateValue(target) {
    const y = q(sel("dateYear"), target)?.value ?? "";
    const m = q(sel("dateMonth"), target)?.value ?? "";
    return [y, m].filter(Boolean).join("-");
  }
  function uploadedFileNames(root2 = document) {
    return qa(sel("fileUploaded"), root2).filter(isVisible).map(text);
  }
  async function uploadFile(target, file) {
    const input = target.matches('input[type="file"]') ? target : q('input[type="file"]', target);
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const root2 = input.closest('[data-automation-id^="formField-"]')?.parentElement ?? document;
    const stem = file.name.replace(/\.[a-z]+$/i, "").slice(0, 12).toLowerCase();
    return !!await waitFor(
      () => uploadedFileNames(root2).some((n) => n.toLowerCase().includes(stem)) || uploadedFileNames().some((n) => n.toLowerCase().includes(stem)),
      2e4,
      250
    ).catch(() => false);
  }
  function readValue(container) {
    switch (kindOf(container)) {
      case "text":
      case "textarea":
        return inputIn(container)?.value ?? "";
      case "dropdown":
        return dropdownValue(container);
      case "multiselect":
        return multiselectSelected(container).join(", ");
      case "radio":
        return radioValue(container);
      case "checkbox": {
        const b = q('input[type="checkbox"], [role="checkbox"]', container) ?? container;
        return b.checked || b.getAttribute("aria-checked") === "true" ? "true" : "";
      }
      case "checkboxGroup":
        return qa('input[type="checkbox"], [role="checkbox"]', container).filter((b) => b.checked || b.getAttribute("aria-checked") === "true").map(optionLabel).join(", ");
      case "date":
        return dateValue(container);
      case "file":
        return uploadedFileNames(container.parentElement ?? container).join(", ");
      default:
        return "";
    }
  }
  async function optionsOf(container) {
    switch (kindOf(container)) {
      case "dropdown":
        return readDropdownOptions(container);
      case "radio":
        return radioOptions(container);
      case "checkboxGroup":
        return checkboxGroupOptions(container);
      case "checkbox":
        return ["true", "false"];
      default:
        return [];
    }
  }
  async function writeValue(container, answer) {
    switch (kindOf(container)) {
      case "text":
      case "textarea":
        return setText(container, answer);
      case "dropdown":
        return selectDropdown(container, answer);
      case "multiselect":
        return multiselectPick(container, answer);
      case "radio":
        return selectRadio(container, answer);
      case "checkbox":
        return setCheckbox(container, /^(true|yes|y|1|checked)$/i.test(answer.trim()));
      case "checkboxGroup":
        return checkInGroup(container, answer);
      case "date":
        return setDate(container, answer);
      default:
        throw new NeedsHuman(`Can't fill "${labelOf(container)}"`, labelOf(container));
    }
  }

  // src/workday/detect.ts
  var WORKDAY_HOST_RX = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday|workdayjobs)\.com$/i;
  function isWorkdayHost(host2 = location.hostname) {
    return WORKDAY_HOST_RX.test(host2);
  }
  function hasWorkdayApp() {
    return !!document.querySelector("[data-automation-id]");
  }
  function tenantHost() {
    return location.hostname.toLowerCase();
  }
  function siteName(path = location.pathname) {
    const parts = path.split("/").filter(Boolean);
    const i = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0] ?? "") ? 1 : 0;
    return parts[i] ?? "";
  }
  function reqIdFromUrl(path = location.pathname) {
    const m = path.match(/_([A-Za-z]{0,6}-?\d[\w-]*)(?=\/|$)/);
    return m ? m[1] : "";
  }
  function jobKeyFor(host2, reqId) {
    return `${host2}|${reqId}`;
  }
  function nextButton() {
    return byAid("next") ?? qa("footer button, [data-automation-id*='footer'] button").find(
      (b) => isVisible(b) && (NEXT_TEXT_RX.test(text(b)) || SUBMIT_RX.test(text(b)))
    ) ?? null;
  }
  function activeStepName() {
    const s = byAid("progressActive");
    if (s) return text(s);
    const cur = qa('[aria-current="step"]').find(isVisible);
    return text(cur);
  }
  function heading() {
    const h = byAid("pageHeader") ?? qa("main h2, main h1, h2, h1").find(isVisible) ?? null;
    return text(h);
  }
  var STEP_RX = STEP_PATTERNS;
  function isSubmitButton(btn) {
    return !!btn && SUBMIT_RX.test(text(btn) || btn.getAttribute("aria-label") || "");
  }
  function classifyStep(name) {
    for (const [rx2, kind] of STEP_RX) if (rx2.test(name)) return kind;
    return null;
  }
  function detectPage() {
    const body = text(document.body).slice(0, 5e3);
    const next = nextButton();
    if (SUBMITTED_RX.test(body) && !next)
      return "submitted";
    if (ALREADY_APPLIED_RX.test(body) && !anyAid("progressActive")) return "alreadyApplied";
    if (SOMETHING_WRONG_RX.test(body) && !qa('[data-automation-id^="formField-"]').some(isVisible)) return "somethingWrong";
    if (anyAid("verifyPassword") || anyAid("createAccountSubmit")) return "createAccount";
    if (anyAid("signInSubmit") || anyAid("password") && anyAid("email")) return "signIn";
    if (anyAid("signInWithEmail") && !anyAid("progressActive")) return "signIn";
    if (VERIFY_EMAIL_RX.test(body) && !anyAid("password") && !next)
      return "verifyEmail";
    if (anyAid("autofillWithResume") || anyAid("applyManually")) return "applyMethod";
    const PAGES = [
      ["pageReview", "review"],
      ["pageSelfId", "selfIdentify"],
      ["pageVoluntary", "voluntaryDisclosures"],
      ["pageQuestions", "questions"],
      ["pageMyExp", "myExperience"],
      ["pageMyInfo", "myInformation"],
      ["pageAutofill", "resumeUpload"]
    ];
    for (const [key2, kind] of PAGES) if (anyAid(key2)) return kind;
    const step = activeStepName();
    if (step) {
      if (isSubmitButton(next)) return "review";
      const kind = classifyStep(step);
      if (kind) return kind;
    }
    if (!step && anyAid("fileInput") && (/autofill|upload (your )?(resume|cv)|quick apply|resume\/cv|lebenslauf|curriculum|currículo|cv/i.test(body) || !qa('[data-automation-id^="formField-"]').some(isVisible)))
      return "resumeUpload";
    const h = heading();
    const byHeading = h ? classifyStep(h) : null;
    if (byHeading && (next || byHeading === "review")) return byHeading;
    if (anyAid("firstName") || anyAid("address1") || anyAid("phoneNumber")) return "myInformation";
    if (anyAid("workSection") || anyAid("eduSection") || anyAid("skills")) return "myExperience";
    if (anyAid("gender") || anyAid("ethnicity") || anyAid("veteran") || anyAid("agreement")) return "voluntaryDisclosures";
    if (anyAid("disability") || anyAid("selfIdDate")) return "selfIdentify";
    if (anyAid("questionnaire")) return "questions";
    if (isSubmitButton(next)) return "review";
    if (next && qa('[data-automation-id^="formField-"]').some(isVisible)) return "questions";
    if (anyAid("applyButton") || anyAid("jobDescription")) return "jobPosting";
    if (anyAid("candidateHome")) return "candidateHome";
    return "unknown";
  }
  function scrapeJob() {
    const descEl = byAid("jobDescription");
    if (!descEl) return null;
    const host2 = tenantHost();
    let reqId = reqIdFromUrl();
    const reqText = text(byAid("jobReqId"));
    if (!reqId && reqText) reqId = (reqText.match(/[A-Za-z]{0,6}-?\d[\w-]*\s*$/)?.[0] ?? reqText).trim();
    if (!reqId) reqId = location.pathname.split("/").filter(Boolean).pop() ?? "unknown";
    const title = text(byAid("jobTitle")) || text(q("h2")) || document.title;
    const locEl = byAid("jobLocation");
    const description = (descEl.innerText || text(descEl)).slice(0, 2e4);
    return {
      key: jobKeyFor(host2, reqId),
      tenantHost: host2,
      site: siteName(),
      reqId,
      title,
      location: text(locEl).replace(/^(locations?|standorte?|lieux?|ubicaci[oó]n(es)?|localiza[cç][aã]o|sede|sedi|locaties?|lokalizacj[ae])\s*/iu, ""),
      description,
      language: detectLanguage(description) || urlLanguage(location.pathname) || "en",
      url: location.href.replace(/\/apply.*$/, ""),
      capturedAt: Date.now()
    };
  }
  function errorMessages() {
    const out = [];
    const banner = byAid("errorBanner");
    if (banner) {
      for (const b of qa("button, a, li", banner)) {
        const t = text(b);
        if (t && !out.some((o) => o.text === t)) out.push({ text: t, el: b });
      }
      if (!out.length && text(banner)) out.push({ text: text(banner), el: banner });
    }
    for (const e of qa(sel("errorMessage")).filter(isVisible)) {
      const t = text(e);
      if (t && !out.some((o) => o.text === t)) out.push({ text: t, el: e });
    }
    return out;
  }

  // src/workday/types.ts
  var DEFAULT_WD_SETTINGS = {
    consentCreateAccountTerms: false,
    consentDisclosureTerms: false,
    useMasterPassword: false,
    requireDocApproval: true,
    llmAnswers: true,
    trustedInputFallback: false,
    maxSkills: 15,
    fieldDelayMs: 120,
    externalTailorUrl: "",
    externalTailorToken: "",
    externalAutoRequest: false,
    fallbackToMasterCv: true,
    docLanguage: "auto"
  };

  // src/workday/store.ts
  var K = {
    profile: "wd:profile",
    settings: "wd:settings",
    masterCv: "wd:masterCv",
    masterCvText: "wd:masterCvText",
    masterCoverLetter: "wd:masterCoverLetter",
    answers: "wd:answerBank",
    apps: "wd:applications",
    job: (key2) => `wd:job:${key2}`,
    lastJob: (host2) => `wd:lastJob:${host2}`,
    docs: (key2) => `wd:docs:${key2}`,
    run: (host2) => `wd:run:${host2}`
  };
  async function get(key2) {
    const out = await chrome.storage.local.get(key2);
    return out?.[key2];
  }
  async function set(key2, value) {
    await chrome.storage.local.set({ [key2]: value });
  }
  function emptyProfile() {
    return {
      personal: {
        firstName: "",
        lastName: "",
        preferredName: "",
        email: "",
        phone: { countryName: "", countryCode: "", number: "", deviceType: "Mobile" },
        address: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "" },
        linkedin: "",
        website: "",
        github: ""
      },
      summary: "",
      skills: [],
      work: [],
      education: [],
      certifications: [],
      languages: [],
      answers: {
        authorizedCountries: [],
        needsSponsorship: false,
        salaryExpectation: "",
        noticePeriod: "",
        earliestStartDate: "",
        willingToRelocate: false,
        openToHybrid: true,
        openToOnsite: true,
        source: "LinkedIn",
        previouslyWorkedHere: false
      },
      eeo: {
        gender: "decline",
        hispanicOrLatino: "decline",
        ethnicity: "decline",
        veteran: "decline",
        disability: "decline"
      }
    };
  }
  function normalizeProfile(p) {
    const base = emptyProfile();
    if (!p) return base;
    return {
      ...base,
      ...p,
      personal: {
        ...base.personal,
        ...p.personal,
        phone: { ...base.personal.phone, ...p.personal?.phone },
        address: { ...base.personal.address, ...p.personal?.address }
      },
      answers: { ...base.answers, ...p.answers },
      eeo: { ...base.eeo, ...p.eeo },
      work: (p.work ?? []).map((w, i) => ({ ...w, id: w.id || `w${i + 1}`, bullets: w.bullets ?? [] })),
      education: (p.education ?? []).map((e, i) => ({ ...e, id: e.id || `e${i + 1}` })),
      skills: p.skills ?? [],
      certifications: p.certifications ?? [],
      languages: p.languages ?? []
    };
  }
  async function getProfile() {
    return normalizeProfile(await get(K.profile));
  }
  async function getWdSettings() {
    return { ...DEFAULT_WD_SETTINGS, ...await get(K.settings) ?? {} };
  }
  async function getMasterCv() {
    return get(K.masterCv);
  }
  async function saveJob(job) {
    await set(K.job(job.key), job);
    await set(K.lastJob(job.tenantHost), job.key);
  }
  async function getJob(key2) {
    return get(K.job(key2));
  }
  async function getLastJobKey(host2) {
    return get(K.lastJob(host2));
  }
  async function getDocs(jobKey) {
    return get(K.docs(jobKey));
  }
  async function getRun(host2) {
    return get(K.run(host2));
  }
  async function saveRun(run) {
    run.updatedAt = Date.now();
    if (run.log.length > 300) run.log = run.log.slice(-300);
    await set(K.run(run.tenantHost), run);
  }
  function normalizeLabel(label) {
    return label.toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  async function getAnswerBank() {
    return await get(K.answers) ?? {};
  }
  async function rememberAnswer(label, answer) {
    const bank = await getAnswerBank();
    bank[normalizeLabel(label)] = { label, answer, at: Date.now() };
    await set(K.answers, bank);
  }
  async function getApplications() {
    return await get(K.apps) ?? [];
  }
  async function recordApplication(app) {
    const list = await getApplications();
    if (list.some((a) => a.jobKey === app.jobKey)) return;
    list.unshift(app);
    await set(K.apps, list.slice(0, 1e3));
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function docToFile(doc) {
    return new File([base64ToBytes(doc.base64)], doc.fileName, { type: doc.mime });
  }

  // src/workday/context.ts
  async function pace(ctx) {
    await sleep(ctx.settings.fieldDelayMs + Math.floor(Math.random() * 60));
  }
  function addFlag(run, f) {
    if (!run.flags.some((x) => x.label === f.label && x.page === f.page)) run.flags.push(f);
  }
  function pickCv(ctx) {
    if (ctx.docs) {
      if (ctx.docs.approved || !ctx.settings.requireDocApproval) return docToFile(ctx.docs.cv);
      throw new NeedsHuman("Approve this job's CV and cover letter in the side panel (Workday tab), then click Resume.");
    }
    if (ctx.masterCv && ctx.settings.fallbackToMasterCv) return docToFile(ctx.masterCv);
    return null;
  }
  function pickCoverLetter(ctx) {
    if (ctx.docs?.coverLetter && (ctx.docs.approved || !ctx.settings.requireDocApproval)) return docToFile(ctx.docs.coverLetter);
    return null;
  }

  // src/workday/auth.ts
  async function getCreds(host2) {
    return await chrome.runtime.sendMessage({ type: "wd:cred:get", tenantHost: host2 });
  }
  function captchaPresent() {
    return qa('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i], [data-automation-id*="captcha" i]').some(isVisible);
  }
  function emailFor(ctx, creds) {
    return creds.cred?.email || ctx.profile.personal.email || creds.master?.email || "";
  }
  async function chooseEmailSignIn() {
    const btn = byAid("signInWithEmail") ?? buttonByText(SIGN_IN_WITH_EMAIL_RX);
    if (btn && !byAid("password")) {
      await humanClick(btn);
      await waitStable(400);
      return true;
    }
    return false;
  }
  async function submit(key2, label) {
    const btn = byAid(key2) ?? buttonByText(label);
    if (!btn) throw new NeedsHuman("Couldn't find the submit button on the sign-in form.");
    await humanClick(btn);
    await sleep(400);
    await waitStable(700, 15e3);
  }
  async function handleSignIn(ctx) {
    await chooseEmailSignIn();
    if (captchaPresent()) throw new NeedsHuman("Solve the CAPTCHA, then click Resume.");
    const host2 = ctx.run.tenantHost;
    const creds = await getCreds(host2);
    const cred = creds.cred ?? (ctx.settings.useMasterPassword ? creds.master : null);
    if (!cred) {
      const create = byAid("createAccountLink") ?? buttonByText(CREATE_ACCOUNT_TEXT_RX);
      if (create && ctx.run.createAttempts < 2) {
        ctx.log("No saved account for this employer — switching to Create Account");
        await humanClick(create);
        await waitStable(500);
        return;
      }
      throw new NeedsHuman("No saved password for this employer. Sign in yourself (it will be remembered if you use Create Account here), then click Resume.");
    }
    if (ctx.run.authAttempts >= 2) {
      throw new NeedsHuman("Sign-in failed twice. Use 'Forgot password' or update the saved password in Workday settings, then click Resume.");
    }
    ctx.run.authAttempts++;
    await ctx.save();
    const email = byAid("email");
    const pw = byAid("password");
    if (!email || !pw) throw new NeedsHuman("Sign-in form fields not found.");
    await setText(email, cred.email || emailFor(ctx, creds));
    await pace(ctx);
    await setText(pw, cred.password);
    await pace(ctx);
    await submit("signInSubmit", SIGN_IN_TEXT_RX);
    const errs = errorMessages().map((e) => e.text).join(" ");
    if (AUTH_FAILED_RX.test(errs) || LOCKED_RX.test(errs)) {
      if (LOCKED_RX.test(errs)) throw new NeedsHuman("This account is locked. Reset the password from the sign-in page, then click Resume.");
      ctx.log(`Sign-in rejected: ${errs}`, "warn");
      if (!creds.cred && ctx.run.createAttempts < 2) {
        const create = byAid("createAccountLink");
        if (create) {
          await humanClick(create);
          await waitStable(500);
          return;
        }
      }
      throw new NeedsHuman("Sign-in was rejected. Check the saved password (Workday settings) or use 'Forgot password', then click Resume.");
    }
    if (VERIFY_EMAIL_RX.test(text(document.body).slice(0, 3e3)) && !byAid("next")) {
      throw new NeedsHuman("Workday wants you to verify your email. Click the link in the email it sent, sign in again if asked, then click Resume.");
    }
    ctx.log("Signed in");
  }
  async function handleCreateAccount(ctx) {
    if (captchaPresent()) throw new NeedsHuman("Solve the CAPTCHA, then click Resume.");
    const host2 = ctx.run.tenantHost;
    const creds = await getCreds(host2);
    if (creds.cred && ctx.run.authAttempts < 2) {
      const link = byAid("signInLink") ?? buttonByText(SIGN_IN_TEXT_RX);
      if (link) {
        ctx.log("Account already saved for this employer — switching to Sign In");
        await humanClick(link);
        await waitStable(500);
        return;
      }
    }
    if (ctx.run.createAttempts >= 2) throw new NeedsHuman("Account creation failed twice. Finish it yourself, then click Resume.");
    const email = ctx.profile.personal.email || creds.master?.email;
    if (!email) throw new NeedsHuman("Add your email to the Workday profile (Settings) first.");
    let password;
    if (ctx.settings.useMasterPassword && creds.master) {
      password = creds.master.password;
      await chrome.runtime.sendMessage({ type: "wd:cred:set", tenantHost: host2, email, password });
    } else {
      const r = await chrome.runtime.sendMessage({ type: "wd:cred:generate", tenantHost: host2, email });
      password = r.password;
    }
    ctx.run.createAttempts++;
    await ctx.save();
    const emailEl = byAid("email");
    const pw = byAid("password");
    const verify = byAid("verifyPassword");
    if (!emailEl || !pw) throw new NeedsHuman("Create-account form fields not found.");
    await setText(emailEl, email);
    await pace(ctx);
    await setText(pw, password);
    await pace(ctx);
    if (verify) await setText(verify, password);
    await pace(ctx);
    const terms = byAid("createAccountCheckbox");
    if (terms) {
      if (!ctx.settings.consentCreateAccountTerms) {
        throw new NeedsHuman("Read and tick the account terms box (or allow it once in Workday settings), then click Resume.", "Create account terms");
      }
      if (!await setCheckbox(terms, true)) throw new NeedsHuman("Couldn't tick the account terms box — tick it, then click Resume.");
    }
    await submit("createAccountSubmit", CREATE_ACCOUNT_TEXT_RX);
    const errs = errorMessages().map((e) => e.text).join(" ");
    if (ACCOUNT_EXISTS_RX.test(errs)) {
      ctx.log("An account already exists for this email — switching to Sign In", "warn");
      if (!(ctx.settings.useMasterPassword && creds.master)) {
        throw new NeedsHuman(
          "You already have an account with this employer, but its password isn't saved. Sign in (or use 'Forgot password'), then click Resume. Tip: turn on 'one password for all tenants' in settings."
        );
      }
      const link = byAid("signInLink");
      if (link) await humanClick(link);
      await waitStable(500);
      return;
    }
    if (/password|passwort|kennwort|mot de passe|contraseña|senha|wachtwoord|hasło|パスワード|密码/iu.test(errs)) throw new NeedsHuman(`Workday rejected the password: ${errs}`);
    if (errs) throw new NeedsHuman(`Account creation error: ${errs}`);
    ctx.log("Account created; credentials saved (encrypted) for this employer");
  }

  // src/workday/ohHooks.ts
  var hooks = {};
  function setHooks(h) {
    clearHooks();
    Object.assign(hooks, h);
  }
  function clearHooks() {
    for (const k of Object.keys(hooks)) delete hooks[k];
  }

  // src/workday/answers.ts
  var SENSITIVE_RX2 = SENSITIVE_RX;
  var yesNo = (b) => b ? "Yes" : "No";
  function fullName(p) {
    return `${p.personal.firstName} ${p.personal.lastName}`.trim();
  }
  function monthsBetween(a, b) {
    const [ay, am] = a.split("-").map(Number);
    const now = /* @__PURE__ */ new Date();
    const [by, bm] = b ? b.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
    return Math.max(0, (by - ay) * 12 + ((bm || 1) - (am || 1)));
  }
  function yearsOfExperience(p, label) {
    const l = label.toLowerCase();
    const skill = p.skills.find((s) => s.length > 1 && l.includes(s.toLowerCase()));
    const roles = skill ? p.work.filter((w) => `${w.title} ${w.bullets.join(" ")}`.toLowerCase().includes(skill.toLowerCase())) : p.work;
    const months = roles.reduce((m, w) => m + (w.start ? monthsBetween(w.start, w.current ? void 0 : w.end) : 0), 0);
    return Math.floor(months / 12);
  }
  function bucketFor(n, options) {
    for (const o of options) {
      const range = o.match(/(\d+)\s*(?:-|–|to|bis|à|a|até|tot|do|〜|~|至)\s*(\d+)/iu);
      if (range && n >= +range[1] && n <= +range[2]) return o;
      const plus = o.match(new RegExp("(\\d+)\\s*\\+|(\\d+)\\s*\\p{L}*\\s*(?:or more|and above|oder mehr|und mehr|ou plus|o más|ou mais|o più|of meer|lub więcej|以上)", "iu"));
      if (plus && n >= +(plus[1] ?? plus[2])) return o;
      const more = o.match(/(?:more than|over|mehr als|über|plus de|más de|mais de|più di|meer dan|ponad|powyżej)\s*(\d+)/iu);
      if (more && n > +more[1]) return o;
      const less = o.match(/(?:less than|under|<|weniger als|unter|moins de|menos de|meno di|minder dan|mniej niż|未満)\s*(\d+)/iu);
      if (less && n < +less[1]) return o;
    }
    return null;
  }
  function countryInText(text2, p) {
    const t = norm(text2);
    const candidates = [...p.answers.authorizedCountries, p.personal.address.country, "united states", "united kingdom", "canada", "ireland", "germany", "france", "india", "australia", "netherlands", "spain", "singapore"];
    return candidates.find((c) => c && t.includes(norm(c))) ?? null;
  }
  function authorizedFor(label, ctx) {
    const p = ctx.profile;
    const c = countryInText(label, p) ?? countryInText(ctx.job?.location ?? "", p) ?? p.personal.address.country;
    return p.answers.authorizedCountries.some((a) => similarity(a, c) >= 0.85);
  }
  var EEO_RX = new RegExp([Q.gender, Q.hispanic, Q.ethnicity, Q.veteran, Q.disability].map((r) => r.source).join("|"), "iu");
  var CONTACT_RX = new RegExp(
    [Q.firstName, Q.lastName, Q.fullName, Q.email, Q.phone, Q.address1, Q.city, Q.postal, Q.country, Q.region, Q.linkedin, Q.github, Q.website].map((r) => r.source).join("|"),
    "iu"
  );
  function optionFor(answer, options) {
    if (!options.length) return answer;
    const num = answer.match(/^\s*(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)?\s*$/i);
    const bucket = num ? bucketFor(Math.floor(+num[1]), options) : null;
    if (bucket) return bucket;
    let best = null;
    let score = 0;
    for (const o of options) {
      const s = similarity(o, answer);
      if (s > score) {
        score = s;
        best = o;
      }
    }
    return score >= 0.6 ? best : null;
  }
  var RULES = [
    [Q.sponsorship, (_l, c) => yesNo(c.profile.answers.needsSponsorship)],
    [Q.authorized, (l, c) => yesNo(authorizedFor(l, c))],
    [Q.adult, () => "Yes"],
    [Q.salary, (_l, c) => c.profile.answers.salaryExpectation || null],
    [Q.notice, (_l, c) => c.profile.answers.noticePeriod || null],
    [Q.startDate, (_l, c) => c.profile.answers.earliestStartDate || null],
    [Q.relocate, (_l, c) => yesNo(c.profile.answers.willingToRelocate)],
    [Q.hybrid, (_l, c) => yesNo(c.profile.answers.openToHybrid)],
    [Q.onsite, (_l, c) => yesNo(c.profile.answers.openToOnsite)],
    [Q.previouslyWorked, (_l, c) => yesNo(c.profile.answers.previouslyWorkedHere)],
    [Q.source, (_l, c) => c.profile.answers.source || null],
    [Q.linkedin, (_l, c) => c.profile.personal.linkedin || null],
    [Q.github, (_l, c) => c.profile.personal.github || null],
    [Q.website, (_l, c) => c.profile.personal.website || c.profile.personal.linkedin || null],
    [Q.coverLetter, (_l, c, _o, kind) => kind === "textarea" || kind === "text" ? c.docs?.coverLetterText || null : null],
    [Q.years, (l, c, opts) => {
      const n = yearsOfExperience(c.profile, l);
      return opts.length ? bucketFor(n, opts) : String(n);
    }],
    [Q.firstName, (_l, c) => c.profile.personal.firstName || null],
    [Q.lastName, (_l, c) => c.profile.personal.lastName || null],
    [Q.fullName, (_l, c) => fullName(c.profile) || null],
    [Q.email, (_l, c) => c.profile.personal.email || null],
    [Q.phone, (_l, c) => c.profile.personal.phone.number || null],
    [Q.address1, (_l, c) => c.profile.personal.address.line1 || null],
    [Q.city, (_l, c) => c.profile.personal.address.city || null],
    [Q.postal, (_l, c) => c.profile.personal.address.postalCode || null],
    [Q.country, (_l, c) => c.profile.personal.address.country || null],
    [Q.region, (_l, c) => c.profile.personal.address.region || null],
    [Q.gender, (_l, c) => c.profile.eeo.gender],
    [Q.hispanic, (_l, c) => c.profile.eeo.hispanicOrLatino],
    [Q.ethnicity, (_l, c) => c.profile.eeo.ethnicity],
    [Q.veteran, (_l, c) => c.profile.eeo.veteran],
    [Q.disability, (_l, c) => c.profile.eeo.disability]
  ];
  function eeoWanted(v) {
    if (!v || v === "decline") return "decline";
    if (v === "yes") return "Yes";
    if (v === "no") return "No";
    return v;
  }
  async function resolveAnswer(label, kind, options, ctx, llm) {
    const norm2 = normalizeLabel(label);
    const bank = await getAnswerBank();
    const saved = bank[norm2] ?? Object.values(bank).find((e) => similarity(normalizeLabel(e.label), norm2) >= 0.92);
    if (saved && (!options.length || options.some((o) => similarity(o, saved.answer) >= 0.85))) {
      return { answer: saved.answer, source: "bank" };
    }
    if (hooks.answer && !CONTACT_RX.test(label)) {
      const a = await hooks.answer(label, kind, options).catch(() => null);
      const pick2 = a ? optionFor(a, options) : null;
      if (pick2) return { answer: pick2, source: "host" };
    }
    if (SENSITIVE_RX2.test(label)) return null;
    for (const [rx2, fn] of RULES) {
      if (!rx2.test(label)) continue;
      const a = fn(label, ctx, options, kind);
      if (a == null || a === "") break;
      const wanted = EEO_RX.test(label) ? eeoWanted(a) : a;
      if (options.length && wanted !== "decline" && !options.some((o) => similarity(o, wanted) >= 0.6)) break;
      if (options.length && wanted === "decline" && !options.some((o) => DECLINE_RX2.test(o))) return null;
      return { answer: wanted, source: "rule" };
    }
    if (!ctx.settings.llmAnswers) return null;
    if (EEO_RX.test(label) || /religio|sexual orientation|orientation sexuelle|orientación sexual|sexuelle orientierung/iu.test(label)) return null;
    const system = `You answer job-application questions for a candidate, honestly, using ONLY the candidate profile and job below.
If the profile doesn't support an answer, return confidence 0. Never invent facts.
If OPTIONS are listed, "answer" must be exactly one of them (copy it verbatim, in the form's language).
Write free-text answers in the SAME LANGUAGE as the question. Keep them concise (under 120 words unless the question asks for more).
Return ONLY JSON: {"answer": string, "confidence": number between 0 and 1}`;
    const prompt = `QUESTION: ${label}
CONTROL: ${kind}
${options.length ? `OPTIONS: ${JSON.stringify(options.slice(0, 80))}` : ""}
JOB: ${ctx.job ? `${ctx.job.title} — ${ctx.job.location}
${ctx.job.description.slice(0, 3e3)}` : "unknown"}
PROFILE: ${JSON.stringify({
      name: fullName(ctx.profile),
      location: ctx.profile.personal.address,
      summary: ctx.profile.summary,
      skills: ctx.profile.skills,
      work: ctx.profile.work.map((w) => ({ title: w.title, company: w.company, start: w.start, end: w.current ? "present" : w.end, bullets: w.bullets.slice(0, 4) })),
      education: ctx.profile.education,
      answers: ctx.profile.answers
    })}`;
    try {
      const reply = await llm(system, prompt);
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const j = JSON.parse(m[0]);
      if (!j.answer || (j.confidence ?? 0) < 0.6) return null;
      if (options.length) {
        const exact = options.find((o) => similarity(o, j.answer) >= 0.9);
        if (!exact) return null;
        return { answer: exact, source: "llm" };
      }
      return { answer: j.answer, source: "llm" };
    } catch {
      return null;
    }
  }

  // src/workday/steps.ts
  var handled = /* @__PURE__ */ new WeakSet();
  function containerOf(el) {
    return el.closest('[data-automation-id^="formField-"]') ?? el;
  }
  async function translateChoice(ctx, c, value) {
    if (!ctx.settings.llmAnswers || kindOf(c) === "multiselect") return false;
    const options = (await optionsOf(c)).filter((o) => o && !/^select one$/i.test(o));
    if (!options.length) return false;
    try {
      const reply = await ctx.llm(
        `Pick the option that means the same as the given value (the form may be in another language). Return ONLY JSON {"option": string|null} with the option copied verbatim, or null if none fits.`,
        `VALUE: ${value}
FIELD: ${labelOf(c)}
OPTIONS: ${JSON.stringify(options.slice(0, 150))}`
      );
      const pick2 = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}").option;
      const exact = pick2 ? options.find((o) => o === pick2 || similarity(o, pick2) >= 0.95) : void 0;
      if (!exact) return false;
      ctx.log(`"${value}" → "${exact}" (translated option)`);
      return writeValue(c, exact);
    } catch {
      return false;
    }
  }
  var touched = /* @__PURE__ */ new WeakSet();
  if (typeof document !== "undefined") {
    const mark = (e) => {
      if (!e.isTrusted) return;
      const c = e.target?.closest?.('[data-automation-id^="formField-"]');
      if (c) touched.add(c);
    };
    for (const t of ["keydown", "mousedown", "paste"]) document.addEventListener(t, mark, true);
  }
  var TENANT_DEFAULTS = /* @__PURE__ */ new Set(["country", "phoneCode", "phoneType"]);
  function caseOnly(a, b) {
    return a !== b && a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  async function fill(ctx, key2, value, root2 = document) {
    const el = field(key2, root2);
    if (!el) return false;
    const c = containerOf(el);
    handled.add(c);
    if (!value) return false;
    const existing = readValue(kindOf(c) === "none" ? el : c);
    const keep = existing && (touched.has(c) || !TENANT_DEFAULTS.has(key2) && !caseOnly(existing, value));
    if (hooks.keepExisting?.() && keep) return true;
    await pace(ctx);
    let ok = await writeValue(kindOf(c) === "none" ? el : c, value).catch((e) => {
      if (e instanceof NeedsHuman) return false;
      throw e;
    });
    if (!ok && ["dropdown", "radio", "checkboxGroup"].includes(kindOf(c))) ok = await translateChoice(ctx, c, value);
    if (!ok) {
      const label = labelOf(c) || key2;
      if (isRequired(c)) ctx.flag(label, `Couldn't set "${value}"`);
      else ctx.log(`Skipped optional "${label}" (couldn't set "${value}")`, "warn");
    }
    return ok;
  }
  function bulletsText(bullets) {
    return bullets.map((b) => `• ${b.replace(/^[•\-*]\s*/, "")}`).join("\n");
  }
  function section(key2, heading2) {
    const byId = byAid(key2);
    if (byId) return byId;
    const h = qa("h2, h3, h4, legend, [role='heading']").find((e) => isVisible(e) && heading2.test(text(e)));
    return h ? h.closest("section, fieldset, [role='group'], div[data-automation-id]") ?? h.parentElement : null;
  }
  function blocks(sectionEl, anchor) {
    const all = qa(sel(anchor), sectionEl).filter(isVisible);
    const anchors = all.filter((a) => !all.some((o) => o !== a && o.contains(a)));
    const count = (el) => anchors.filter((a) => el.contains(a)).length;
    const out = [];
    for (const a of anchors) {
      let b = a;
      while (b.parentElement && b.parentElement !== sectionEl && count(b.parentElement) === 1) b = b.parentElement;
      if (!out.includes(b)) out.push(b);
    }
    return out;
  }
  function addButton(sectionEl) {
    return qa(sel("addButton"), sectionEl).filter(isVisible).pop() ?? buttonByText(ADD_TEXT_RX, sectionEl);
  }
  async function ensureBlockCount(ctx, sectionEl, anchor, n) {
    let bs = blocks(sectionEl, anchor);
    while (bs.length > n) {
      const last = bs[bs.length - 1];
      const del = qa(sel("deleteBlock"), last).find(isVisible) ?? buttonByText(DELETE_TEXT_RX, last);
      if (!del) break;
      await humanClick(del);
      await sleep(300);
      await waitStable(300, 5e3);
      bs = blocks(sectionEl, anchor);
    }
    for (let guard = 0; bs.length < n && guard < n + 2; guard++) {
      const add = addButton(sectionEl);
      if (!add) {
        ctx.flag(text(sectionEl.querySelector("h2,h3,h4,legend")) || anchor, "No Add button found");
        break;
      }
      const before = bs.length;
      await humanClick(add);
      await waitFor(() => blocks(sectionEl, anchor).length > before, 6e3).catch(() => null);
      await waitStable(300, 5e3);
      bs = blocks(sectionEl, anchor);
    }
    return bs;
  }
  async function pruneIncomplete(ctx, sectionEl, anchor) {
    for (let guard = 0; guard < 12; guard++) {
      const bad = blocks(sectionEl, anchor).filter((b) => qa('[data-automation-id^="formField-"]', b).some((c) => isVisible(c) && isRequired(c) && kindOf(c) !== "none" && !readValue(c))).pop();
      if (!bad) return;
      const del = qa(sel("deleteBlock"), bad).find(isVisible) ?? buttonByText(DELETE_TEXT_RX, bad);
      if (!del) return;
      const what = qa('[data-automation-id^="formField-"]', bad).map(readValue).find(Boolean) || "untitled";
      ctx.log(`Removed an incomplete entry the CV parser left: ${what.slice(0, 40)}`);
      await humanClick(del);
      await sleep(300);
      await waitStable(300, 5e3);
    }
  }
  async function markCurrentRole(ctx, sectionEl) {
    const first = blocks(sectionEl, "jobTitleF")[0];
    if (!first) return;
    const box = field("currentlyF", first);
    if (!box) return;
    const c = containerOf(box);
    if (readValue(c) === "true") return;
    const start = dateContainer(first, "start");
    const end = dateContainer(first, "end");
    if (!start || !readValue(start) || end && readValue(end)) return;
    handled.add(c);
    if (await setCheckbox(c, true)) {
      ctx.log('Ticked "I currently work here" on your most recent role (it has no end date)');
      if (end) handled.add(end);
      await waitStable(300, 4e3);
    }
  }
  function dateContainer(block, which) {
    const byId = which === "start" ? field("startDateF", block) : field("endDateF", block);
    if (byId) return containerOf(byId);
    const rx2 = which === "start" ? /^(from|start|first year|von|beginn|de$|du|début|desde|inicio|início|da$|dal|inizio|van|begin|od|開始|开始)/iu : /^(to|end|last year|graduation|bis|ende|à$|au|fin|hasta|até|término|a$|al|fine|tot|eind|do|終了|结束)/iu;
    return qa('[data-automation-id^="formField-"]', block).find((c) => isVisible(c) && rx2.test(labelOf(c)) && kindOf(c) === "date") ?? null;
  }
  function nationalNumber(raw, countryCode = "") {
    const s = String(raw || "").trim();
    const cc = countryCode.replace(/\D/g, "");
    let d = s.replace(/\D/g, "");
    const international = /^(\+|00)/.test(s);
    if (international && s.startsWith("00")) d = d.slice(2);
    if (international && cc && d.startsWith(cc)) d = d.slice(cc.length);
    else if (international) {
      const m = s.match(/^\(?(?:\+|00)\s*(\d{1,3})\)?[\s.\-)]/);
      if (m) d = d.slice(m[1].length);
    }
    if (cc !== "39") d = d.replace(/^0+/, "");
    return d;
  }
  async function sourceFallback(ctx, c) {
    const src = ctx.profile.answers.source;
    const paths = [
      [["Social Media", src], false],
      [["Social Networking", src], false],
      [["Job Board", src], false],
      [["Online Job Board", src], false],
      [["Internet", src], false],
      [["Job Board", "Other"], true],
      [["Online Job Board", "Other"], true],
      [["Job Posting", "Other"], true],
      [["Website", "Other"], true]
    ];
    for (const [path, fallbackFirst] of paths) {
      if (await multiselectPick(c, path[path.length - 1], { path, min: 0.75, fallbackFirst })) {
        ctx.log(`How did you hear about us → ${multiselectSelected(c).join(", ") || path.join(" › ")}`);
        return true;
      }
    }
    for (const v of ["Job Board", "Online Job Board", "Social Media", "Internet"]) if (await selectDropdown(c, v, 0.75)) return true;
    return false;
  }
  async function myInformation(ctx) {
    const me = ctx.profile.personal;
    const sourceEl = field("source");
    if (sourceEl) {
      const c = containerOf(sourceEl);
      handled.add(c);
      if (!readValue(c) && ctx.profile.answers.source) {
        await pace(ctx);
        const ok = await multiselectPick(c, ctx.profile.answers.source) || await selectDropdown(c, ctx.profile.answers.source) || await sourceFallback(ctx, c);
        if (!ok && isRequired(c)) ctx.flag(labelOf(c) || "How did you hear about us", `No option like "${ctx.profile.answers.source}"`);
      }
    }
    const prev = field("previousWorker");
    if (prev) {
      const c = containerOf(prev);
      handled.add(c);
      if (!readValue(c)) await selectRadio(c, ctx.profile.answers.previouslyWorkedHere ? "Yes" : "No");
    }
    if (await fill(ctx, "country", me.address.country)) await waitStable(500, 8e3);
    await fill(ctx, "firstName", me.firstName);
    await fill(ctx, "lastName", me.lastName);
    if (me.preferredName && me.preferredName !== me.firstName) {
      const box = field("preferredCheck");
      if (box && await setCheckbox(box, true)) {
        await waitStable(300, 4e3);
        await fill(ctx, "preferredFirst", me.preferredName);
      }
    }
    await fill(ctx, "address1", me.address.line1);
    await fill(ctx, "address2", me.address.line2);
    await fill(ctx, "city", me.address.city);
    await fill(ctx, "region", me.address.region);
    await fill(ctx, "postal", me.address.postalCode);
    await fill(ctx, "phoneType", me.phone.deviceType || "Mobile");
    const code = field("phoneCode");
    if (code) {
      const c = containerOf(code);
      handled.add(c);
      const want = me.phone.countryName || me.address.country;
      if (want && !multiselectSelected(c).some((s) => similarity(want, s) >= 0.6)) {
        await pace(ctx);
        const ok = await multiselectPick(c, want) || (me.phone.countryCode ? await multiselectPick(c, me.phone.countryCode) : false);
        if (!ok) ctx.flag("Country Phone Code", `No option like "${want}"`);
      }
    }
    await fill(ctx, "phoneNumber", nationalNumber(me.phone.number, me.phone.countryCode));
    const email = field("email");
    if (email && !readValue(containerOf(email))) await fill(ctx, "email", me.email);
  }
  async function fillWork(ctx, block, w) {
    await fill(ctx, "jobTitleF", w.title, block);
    await fill(ctx, "companyF", w.company, block);
    await fill(ctx, "locationF", w.location, block);
    const cur = field("currentlyF", block);
    if (cur) {
      handled.add(containerOf(cur));
      await setCheckbox(containerOf(cur), w.current);
      await waitStable(250, 3e3);
    }
    const start = dateContainer(block, "start");
    if (start && w.start) {
      handled.add(start);
      if (!await setDate(start, w.start)) ctx.flag(`${w.company} start date`, "Date didn't stick");
    }
    if (!w.current && w.end) {
      const end = dateContainer(block, "end");
      if (end) {
        handled.add(end);
        if (!await setDate(end, w.end)) ctx.flag(`${w.company} end date`, "Date didn't stick");
      }
    }
    const bullets = ctx.docs?.tailored?.roles[w.id] ?? w.bullets;
    await fill(ctx, "descriptionF", bulletsText(bullets), block);
  }
  async function fillEducation(ctx, block, e) {
    const school = field("schoolF", block);
    if (school) {
      const c = containerOf(school);
      handled.add(c);
      await pace(ctx);
      let ok = await writeValue(c, e.school);
      if (!ok && kindOf(c) === "multiselect") {
        for (const other of ["Other", "Andere", "Sonstige", "Autre", "Otro", "Outro", "Altro", "Overig", "Inne"]) if (ok = await multiselectPick(c, other, { min: 0.8 })) break;
      }
      if (!ok) ctx.flag(`School: ${e.school}`, "Not in the tenant's school list");
    }
    await fill(ctx, "degreeF", e.degree, block);
    const fos = field("fieldF", block);
    if (fos && e.field) {
      const c = containerOf(fos);
      handled.add(c);
      await pace(ctx);
      const ok = await writeValue(c, e.field);
      if (!ok) ctx.log(`Field of study "${e.field}" not in this form's list — left for you`, "warn");
    }
    await fill(ctx, "gpaF", e.gpa, block);
    const start = dateContainer(block, "start");
    if (start && e.start) {
      handled.add(start);
      await setDate(start, e.start);
    }
    const end = dateContainer(block, "end");
    if (end && e.end) {
      handled.add(end);
      await setDate(end, e.end);
    }
  }
  async function uploadDocuments(ctx) {
    const inputs = qa(sel("fileInput") + ', input[type="file"]');
    if (!inputs.length) return;
    const cv = pickCv(ctx);
    const cl = pickCoverLetter(ctx);
    const labelFor = (i) => labelOf(containerOf(i)) || text(i.closest("section, fieldset")?.querySelector("h2,h3,h4,legend"));
    const clInput = inputs.find((i) => /cover/i.test(labelFor(i)));
    const cvInput = inputs.find((i) => i !== clInput && /resume|cv|attach/i.test(labelFor(i) + " resume")) ?? inputs[0];
    if (cv && cvInput) {
      const root2 = cvInput.closest("section, fieldset, [data-automation-id^='formField-']") ?? document;
      const names = uploadedFileNames(root2);
      if ((hooks.keepExisting?.() || hooks.advance && !hooks.advance()) && names.length) {
        handled.add(containerOf(cvInput));
      } else if (!names.some((n) => n.includes(cv.name.slice(0, 12)))) {
        for (const del of qa(sel("fileDelete"), root2).filter(isVisible)) {
          await humanClick(del);
          await sleep(300);
        }
        ctx.log(`Uploading CV: ${cv.name}`);
        if (!await uploadFile(cvInput, cv)) ctx.flag("Resume/CV", "Upload didn't confirm");
        await waitStable(400, 1e4);
      }
      handled.add(containerOf(cvInput));
    } else if (!cv && cvInput && !uploadedFileNames().length) {
      ctx.flag("Resume/CV", "No CV available — attach one in the side panel or set a master CV");
    }
    if (cl) {
      const target = clInput ?? (cvInput?.multiple ? cvInput : null);
      if (target && !uploadedFileNames().some((n) => n.includes(cl.name.slice(0, 12)))) {
        ctx.log(`Uploading cover letter: ${cl.name}`);
        await uploadFile(target, cl);
        await waitStable(400, 1e4);
      }
    }
  }
  async function myExperience(ctx) {
    await hooks.beforeExperience?.();
    const p = ctx.profile;
    const work = section("workSection", /work experience|employment history|berufserfahrung|expérience professionnelle|experiencia (laboral|profesional)|experiência profissional|esperienza (lavorativa|professionale)|werkervaring|doświadczenie zawodowe|職歴|工作经历/iu);
    if (work && p.work.length) {
      const bs = await ensureBlockCount(ctx, work, "jobTitleF", p.work.length);
      for (let i = 0; i < Math.min(bs.length, p.work.length); i++) await fillWork(ctx, bs[i], p.work[i]);
      ctx.log(`Work experience: ${p.work.length} role(s) filled`);
      await markCurrentRole(ctx, work);
    } else if (work) {
      await markCurrentRole(ctx, work);
      if (hooks.autoSubmit?.()) await pruneIncomplete(ctx, work, "jobTitleF");
    }
    const edu = section("eduSection", /^(education|ausbildung|bildung|formation|educación|formación|educação|formação|istruzione|formazione|opleiding|wykształcenie|学歴|教育)/iu);
    if (edu && p.education.length) {
      const anchor = q(sel("schoolF"), edu) ? "schoolF" : "degreeF";
      const bs = await ensureBlockCount(ctx, edu, anchor, p.education.length);
      for (let i = 0; i < Math.min(bs.length, p.education.length); i++) await fillEducation(ctx, bs[i], p.education[i]);
      ctx.log(`Education: ${p.education.length} entr(ies) filled`);
    } else if (edu && hooks.autoSubmit?.()) {
      await pruneIncomplete(ctx, edu, q(sel("schoolF"), edu) ? "schoolF" : "degreeF");
    }
    const certs = section("certSection", /certification|licen[cs]e|zertifizierung|zertifikat|certificaci|certificaç|certificazion|certificering|certyfikat|資格|证书/iu);
    if (certs && p.certifications.length && q(sel("certNameF"), certs)) {
      const bs = await ensureBlockCount(ctx, certs, "certNameF", p.certifications.length);
      for (let i = 0; i < Math.min(bs.length, p.certifications.length); i++) {
        const c = p.certifications[i];
        await fill(ctx, "certNameF", c.name, bs[i]);
        const dates = qa('[data-automation-id^="formField-"]', bs[i]).filter((x) => kindOf(x) === "date");
        if (dates[0] && c.issued) await setDate(dates[0], c.issued);
        if (dates[1] && c.expires) await setDate(dates[1], c.expires);
      }
    }
    const langs = section("langSection", /^(languages?|sprachen?|langues?|idiomas?|lingue|talen|języki|語学|语言)/iu);
    if (langs && p.languages.length && q(sel("langF"), langs)) {
      const bs = await ensureBlockCount(ctx, langs, "langF", p.languages.length);
      for (let i = 0; i < Math.min(bs.length, p.languages.length); i++) {
        const l = p.languages[i];
        await fill(ctx, "langF", l.language, bs[i]);
        const native = field("nativeF", bs[i]);
        if (native) await setCheckbox(containerOf(native), l.native);
        for (const c of qa('[data-automation-id^="formField-"]', bs[i])) {
          if (handled.has(c) || kindOf(c) !== "dropdown" || !/proficien|reading|writing|speaking|comprehension|overall|kenntnis|niveau|nivel|nível|livello|lesen|schreiben|sprechen|lecture|écriture|oral|lectura|escritura|conversación|leitura|escrita|lettura|scrittura|lezen|schrijven|spreken|poziom/iu.test(labelOf(c))) continue;
          handled.add(c);
          await selectDropdown(c, l.native ? "Native" : l.proficiency, 0.5).then((ok) => ok || selectDropdown(c, "Fluent", 0.5)).then((ok) => ok || selectDropdown(c, "Advanced", 0.5));
        }
      }
    }
    const skillsEl = field("skills");
    if (skillsEl) {
      const c = containerOf(skillsEl);
      handled.add(c);
      const list = (ctx.docs?.tailored?.skills ?? p.skills).slice(0, ctx.settings.maxSkills);
      let added = 0;
      for (const s of list) {
        if (multiselectSelected(c).some((x) => similarity(x, s) >= 0.85)) continue;
        await pace(ctx);
        if (await multiselectPick(c, s, { min: 0.75 })) added++;
      }
      ctx.log(`Skills: ${added} added`);
    }
    await uploadDocuments(ctx);
    const sites = [field("linkedin") ? "" : p.personal.linkedin, p.personal.github, p.personal.website].filter(Boolean);
    const web = section("webSection", /^(websites?|webseiten?|sites? web|sitios web|sites|siti web|websites?|strony)/iu);
    if (web && sites.length) {
      const bs = await ensureBlockCount(ctx, web, "urlF", sites.length);
      for (let i = 0; i < Math.min(bs.length, sites.length); i++) await fill(ctx, "urlF", sites[i], bs[i]);
    }
    await fill(ctx, "linkedin", p.personal.linkedin);
  }
  async function resumeUpload(ctx) {
    const input = byAid("fileInput") ?? q('input[type="file"]');
    const cv = pickCv(ctx);
    if (!input) return;
    if (!cv) throw new NeedsHuman("No CV to upload. Attach one for this job in the side panel (or set a master CV), then click Resume.");
    if (!uploadedFileNames().some((n) => n.includes(cv.name.slice(0, 12)))) {
      ctx.log(`Uploading CV for autofill: ${cv.name}`);
      if (!await uploadFile(input, cv)) throw new NeedsHuman("CV upload didn't confirm. Upload it yourself, then click Resume.");
    }
    await waitStable(1200, 3e4);
  }
  async function eeo(ctx, key2, pref, label) {
    const el = field(key2);
    if (!el) return;
    const c = containerOf(el);
    handled.add(c);
    if (readValue(c)) return;
    const wanted = eeoWanted(pref);
    await pace(ctx);
    let ok;
    if (kindOf(c) === "multiselect") {
      ok = false;
      for (const qy of wanted === "decline" ? ["decline", "not wish", "prefer not", "do not want"] : [wanted]) {
        if (ok = await multiselectPick(c, qy, { min: 0.5 })) break;
      }
    } else {
      ok = await writeValue(c, wanted);
    }
    if (!ok && isRequired(c)) ctx.flag(label, `Couldn't pick "${wanted === "decline" ? "decline to answer" : wanted}"`);
  }
  async function voluntaryDisclosures(ctx) {
    const e = ctx.profile.eeo;
    await eeo(ctx, "gender", e.gender, "Gender");
    await eeo(ctx, "hispanic", e.hispanicOrLatino, "Hispanic or Latino");
    await eeo(ctx, "ethnicity", e.ethnicity, "Ethnicity");
    await eeo(ctx, "veteran", e.veteran, "Veteran status");
    const terms = field("agreement");
    if (terms) {
      const c = containerOf(terms);
      handled.add(c);
      if (ctx.settings.consentDisclosureTerms) await setCheckbox(c, true);
      else if (readValue(c) !== "true") ctx.flag("Terms and conditions", "Your consent is required — tick it yourself or allow it once in settings");
    }
  }
  async function selfIdentify(ctx) {
    const name = `${ctx.profile.personal.firstName} ${ctx.profile.personal.lastName}`.trim();
    await fill(ctx, "selfIdName", name);
    const dateEl = field("selfIdDate");
    if (dateEl) {
      const c = containerOf(dateEl);
      handled.add(c);
      const d = /* @__PURE__ */ new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!readValue(c)) await setDate(c, iso);
    }
    const dis = field("disability");
    if (dis) {
      const c = containerOf(dis);
      handled.add(c);
      const pref = ctx.profile.eeo.disability;
      const wanted = pref === "yes" ? "Yes, I have a disability" : pref === "no" ? "No, I do not have a disability" : "decline";
      const ok = await checkInGroup(c, wanted) || await selectRadio(c, wanted);
      if (!ok) ctx.flag("Disability status", "Couldn't select your saved choice");
    }
  }
  async function genericFill(ctx) {
    const containers = qa('[data-automation-id^="formField-"]').filter(isVisible);
    const optionsCache = /* @__PURE__ */ new Map();
    if (hooks.prefetch) {
      const open = [];
      for (const c of containers) {
        if (handled.has(c) || containers.some((o) => o !== c && o.contains(c) && handled.has(o))) continue;
        const kind = kindOf(c);
        const label = labelOf(c);
        if (kind === "none" || kind === "file" || !label || readValue(c)) continue;
        const options = await optionsOf(c);
        optionsCache.set(c, options);
        open.push({ label, kind, options, required: isRequired(c) });
      }
      if (open.length) await hooks.prefetch(open).catch(() => {
      });
    }
    for (const c of containers) {
      if (handled.has(c)) continue;
      if (containers.some((o) => o !== c && o.contains(c) && handled.has(o))) continue;
      handled.add(c);
      const kind = kindOf(c);
      if (kind === "none" || kind === "file") continue;
      if (readValue(c)) continue;
      const label = labelOf(c);
      if (!label) continue;
      const required = isRequired(c);
      const options = optionsCache.get(c) ?? await optionsOf(c);
      const ans = await resolveAnswer(label, kind, options, ctx, ctx.llm);
      if (!ans) {
        if (required) ctx.flag(label, "Needs your answer");
        continue;
      }
      await pace(ctx);
      const ok = await writeValue(c, ans.answer).catch(() => false);
      if (ok) {
        if (ans.source === "llm") ctx.run.llmFilled.push({ label, answer: ans.answer });
        ctx.log(`${label} → ${ans.answer.slice(0, 60)} (${ans.source})`);
      } else if (required) {
        ctx.flag(label, `Couldn't set "${ans.answer.slice(0, 40)}"`);
      }
    }
  }
  function reviewDiff(ctx) {
    const body = text(document.body).toLowerCase();
    const p = ctx.profile;
    const expect = [
      p.personal.firstName,
      p.personal.lastName,
      p.personal.email,
      ...p.work.map((w) => w.company),
      ...p.work.map((w) => w.title),
      ...p.education.map((e) => e.school)
    ].filter(Boolean);
    return expect.filter((v) => !body.includes(v.toLowerCase()));
  }
  function highlightSubmit(btn) {
    btn.style.outline = "3px solid #c79a6a";
    btn.style.outlineOffset = "3px";
    btn.scrollIntoView({ block: "center" });
  }
  async function fixFieldFromError(ctx, link) {
    await humanClick(link);
    await sleep(300);
    const active2 = document.activeElement;
    const c = active2?.closest('[data-automation-id^="formField-"]');
    if (!c) return false;
    handled.delete(c);
    const label = labelOf(c);
    const ans = await resolveAnswer(label, kindOf(c), await optionsOf(c), ctx, ctx.llm);
    if (!ans) {
      addFlag(ctx.run, { label, reason: "Workday reported an error here", page: ctx.page });
      return false;
    }
    return writeValue(c, ans.answer).catch(() => false);
  }
  function resetHandled() {
    handled = /* @__PURE__ */ new WeakSet();
  }

  // src/workday/overlay.ts
  var host = null;
  var root = null;
  var handlers = { resume: () => {
  }, stop: () => {
  } };
  var hideTimer;
  function setOverlayHandlers(h) {
    handlers = h;
  }
  function removeOverlay() {
    host?.remove();
    host = null;
    root = null;
  }
  var LABELS2 = {
    running: "Filling…",
    paused: "Needs you",
    review: "Ready to submit",
    done: "Submitted",
    error: "Error",
    idle: "Stopped",
    filled: "Page filled — check it, then continue"
    // [oh]
  };
  function renderOverlay(run) {
    if (!document.body) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = void 0;
    }
    if (!host) {
      host = document.createElement("div");
      host.id = "wd-autopilot-overlay";
      host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
      root = host.attachShadow({ mode: "closed" });
      document.body.appendChild(host);
    }
    if (!root) return;
    const color = { running: "#5bc08b", paused: "#e0a86a", review: "#c79a6a", done: "#5bc08b", error: "#e06a6a", idle: "#8892a8", filled: "#5bc08b" }[run.status];
    const last = run.log[run.log.length - 1]?.msg ?? "";
    root.innerHTML = `
    <style>
      .box{font:13px/1.4 system-ui,sans-serif;background:#171a24;color:#e6e9f2;border:1px solid #2a2f40;border-radius:10px;padding:10px 12px;width:300px;box-shadow:0 6px 24px rgba(0,0,0,.35)}
      .top{display:flex;align-items:center;gap:8px;font-weight:600}
      .dot{width:8px;height:8px;border-radius:50%;background:${color}}
      .msg{margin-top:6px;color:#c9cfdd;max-height:72px;overflow:auto}
      .row{display:flex;gap:6px;margin-top:8px}
      button{font:inherit;flex:1;background:#0f1115;color:#e6e9f2;border:1px solid #2a2f40;border-radius:6px;padding:4px 8px;cursor:pointer}
      button.primary{background:#c79a6a;color:#1a1204;border-color:#c79a6a}
      .x{flex:0;padding:0 6px;background:none;border:0;color:#8892a8}
    </style>
    <div class="box" role="status" aria-live="polite">
      <div class="top"><span class="dot"></span>Workday autopilot · ${LABELS2[run.status] ?? run.status}<span style="flex:1"></span><button class="x" data-a="hide" aria-label="Hide">✕</button></div>
      <div class="msg"></div>
      <div class="row">
        ${run.status === "paused" || run.status === "error" ? '<button class="primary" data-a="resume">Resume</button>' : ""}
        ${run.status === "running" ? '<button data-a="stop">Stop</button>' : ""}
      </div>
    </div>`;
    const msg = root.querySelector(".msg");
    msg.textContent = run.pauseReason || last;
    root.querySelectorAll("button[data-a]").forEach(
      (b) => b.addEventListener("click", () => {
        const a = b.dataset.a;
        if (a === "hide") removeOverlay();
        if (a === "resume") handlers.resume();
        if (a === "stop") handlers.stop();
      })
    );
    if (run.status === "idle" || run.status === "filled") hideTimer = window.setTimeout(removeOverlay, 4e3);
  }

  // src/workday/engine.ts
  var active = false;
  var submitWatcher;
  function newRun(host2, jobKey) {
    return {
      tenantHost: host2,
      jobKey,
      status: "running",
      page: "unknown",
      attempts: 0,
      done: [],
      flags: [],
      llmFilled: [],
      log: [],
      authAttempts: 0,
      createAttempts: 0,
      updatedAt: Date.now()
    };
  }
  function broadcast(run) {
    chrome.runtime.sendMessage({ type: "wd:progress", state: run }).catch(() => {
    });
    renderOverlay(run);
  }
  function notify(title, message) {
    chrome.runtime.sendMessage({ type: "wd:notify", title, message }).catch(() => {
    });
  }
  async function resolveJob(run) {
    const host2 = tenantHost();
    const fromPage = scrapeJob();
    if (fromPage) {
      const existing = await getJob(fromPage.key);
      if (!existing) await saveJob(fromPage);
      run.jobKey = fromPage.key;
      return existing ?? fromPage;
    }
    const reqId = reqIdFromUrl();
    const keys = [run.jobKey, reqId ? jobKeyFor(host2, reqId) : null, await getLastJobKey(host2)].filter(Boolean);
    for (const k of keys) {
      const j = await getJob(k);
      if (j) {
        run.jobKey = j.key;
        return j;
      }
    }
    return null;
  }
  async function buildCtx(run) {
    const [profile, settings, masterCv] = await Promise.all([
      hooks.profile ? hooks.profile() : getProfile(),
      // [oh]
      hooks.settings ? hooks.settings() : getWdSettings(),
      hooks.masterCv ? hooks.masterCv() : getMasterCv()
    ]);
    enableTrustedFallback(settings.trustedInputFallback);
    const job = await resolveJob(run);
    const docs = job ? await getDocs(job.key) ?? null : null;
    const ctx = {
      profile,
      settings,
      job,
      docs,
      masterCv,
      run,
      page: run.page,
      log(msg, level = "info") {
        run.log.push({ at: Date.now(), level, msg });
        broadcast(run);
      },
      flag(label, reason) {
        addFlag(run, { label, reason, page: ctx.page });
        run.log.push({ at: Date.now(), level: "warn", msg: `Needs you: ${label} — ${reason}` });
        broadcast(run);
      },
      async llm(system, prompt) {
        const r = await chrome.runtime.sendMessage({ type: "wd:llm", system, prompt, json: true, maxTokens: 600 });
        if (!r?.ok) throw new Error(r ? r.error : "LLM unavailable");
        return r.text;
      },
      async save() {
        await saveRun(run);
        broadcast(run);
      }
    };
    return ctx;
  }
  async function clickNext(ctx) {
    const btn = nextButton();
    if (!btn) throw new NeedsHuman("Couldn't find the Next / Save and Continue button.");
    if (isSubmitButton(btn)) return "stop";
    const before = `${activeStepName()}|${detectPage()}`;
    await humanClick(btn);
    await sleep(500);
    const outcome = await waitFor(
      () => {
        if (errorMessages().length) return "error";
        const now = `${activeStepName()}|${detectPage()}`;
        return now !== before ? "moved" : null;
      },
      2e4,
      200
    ).catch(() => "timeout");
    if (outcome === "moved") return "next";
    ctx.run.attempts++;
    if (outcome === "error") {
      const errs = errorMessages();
      ctx.log(`Workday reported ${errs.length} error(s): ${errs.map((e) => e.text).join(" | ").slice(0, 300)}`, "warn");
      if (ctx.run.attempts > 2) throw new NeedsHuman(`Fix these and click Resume: ${errs.map((e) => e.text).join("; ").slice(0, 400)}`);
      resetHandled();
      for (const e of errs) if (e.el.matches("button, a, [role='button'], li")) await fixFieldFromError(ctx, e.el).catch(() => false);
      return "continue";
    }
    if (ctx.run.attempts > 3) throw new NeedsHuman("The page didn't advance after Next. Check for unanswered fields, then click Resume.");
    return "continue";
  }
  function requiredFlagsHere(ctx) {
    return ctx.run.flags.filter((f) => f.page === ctx.page);
  }
  function pageFilled(ctx) {
    ctx.run.status = "filled";
    ctx.run.pauseReason = void 0;
    ctx.log("Page filled — check it, then continue");
    void ctx.save();
    return "stop";
  }
  async function fillAndNext(ctx, handler) {
    if (handler) await handler(ctx);
    await genericFill(ctx);
    await ctx.save();
    const flags = requiredFlagsHere(ctx);
    if (hooks.advance && !hooks.advance() && !flags.length) return pageFilled(ctx);
    if (flags.length) {
      throw new NeedsHuman(`Answer ${flags.length} field(s) on this page, then click Resume: ${flags.map((f) => f.label).join(", ").slice(0, 300)}`);
    }
    return clickNext(ctx);
  }
  async function waitForExternalDocs(ctx) {
    if (!ctx.job || ctx.docs || !ctx.settings.externalAutoRequest || !ctx.settings.externalTailorUrl) return;
    ctx.log("Waiting for your tailoring tool to return documents…");
    const start = Date.now();
    while (Date.now() - start < 9e4) {
      const d = await getDocs(ctx.job.key);
      if (d) {
        ctx.docs = d;
        ctx.log(`Documents received (${d.cv.fileName})`);
        return;
      }
      await sleep(1500);
    }
    ctx.log("Tailoring tool didn't respond in 90 s — continuing with the fallback CV", "warn");
  }
  var ASSIST_PAGES = ["resumeUpload", "myInformation", "myExperience", "questions", "voluntaryDisclosures", "selfIdentify"];
  async function handlePage(ctx, page) {
    if (hooks.advance && !hooks.advance() && !ASSIST_PAGES.includes(page)) return "stop";
    switch (page) {
      case "jobPosting": {
        if (ctx.job) chrome.runtime.sendMessage({ type: "wd:jobCaptured", job: ctx.job }).catch(() => {
        });
        await waitForExternalDocs(ctx);
        const apply = byAid("applyButton") ?? qa("a, button").find((b) => isVisible(b) && APPLY_TEXT_RX.test(text(b))) ?? null;
        if (!apply) throw new NeedsHuman("No Apply button on this posting (it may be closed).");
        ctx.log(`Applying: ${ctx.job?.title ?? "job"}`);
        await humanClick(apply);
        await waitStable(600);
        return "next";
      }
      case "applyMethod": {
        await waitForExternalDocs(ctx);
        const btn = byAid("applyManually");
        if (!btn) throw new NeedsHuman('Choose "Apply Manually", then click Resume.');
        ctx.log("Apply method: Apply Manually");
        await humanClick(btn);
        await waitStable(600);
        return "next";
      }
      case "signIn":
        await handleSignIn(ctx);
        return "continue";
      case "createAccount":
        await handleCreateAccount(ctx);
        return "continue";
      case "verifyEmail":
        throw new NeedsHuman("Verify your email using the link Workday sent, sign in if asked, then click Resume.");
      case "resumeUpload":
        await resumeUpload(ctx);
        if (hooks.advance && !hooks.advance()) return pageFilled(ctx);
        return clickNext(ctx);
      case "myInformation":
        return fillAndNext(ctx, myInformation);
      case "myExperience":
        return fillAndNext(ctx, myExperience);
      case "questions":
        return fillAndNext(ctx);
      case "voluntaryDisclosures":
        return fillAndNext(ctx, voluntaryDisclosures);
      case "selfIdentify":
        return fillAndNext(ctx, selfIdentify);
      case "review": {
        const missing = reviewDiff(ctx);
        if (missing.length) ctx.log(`Not visible on Review (check): ${missing.join(", ")}`, "warn");
        if (ctx.run.llmFilled.length) ctx.log(`AI-answered (please check): ${ctx.run.llmFilled.map((x) => x.label).join("; ")}`, "warn");
        const btn = nextButton();
        if (hooks.autoSubmit?.() && btn && isSubmitButton(btn)) return submitApplication(ctx, btn);
        if (btn) highlightSubmit(btn);
        ctx.run.status = "review";
        ctx.run.pauseReason = "Review everything, then click Submit yourself.";
        await ctx.save();
        notify("Workday application ready", `${ctx.job?.title ?? "Application"} is filled — review and click Submit.`);
        watchForSubmission();
        hooks.onFinish?.(ctx.run, "review");
        return "stop";
      }
      case "submitted":
        await markSubmitted(ctx.run);
        return "stop";
      case "candidateHome":
        throw new NeedsHuman("You're on your candidate home page. Open the job (or the draft under My Applications), then click Resume.");
      case "alreadyApplied":
        throw new Error("You have already applied for this job (Workday allows one application per job)");
      case "somethingWrong": {
        const k = `ua-wd-refresh|${location.pathname}`;
        const n = Number(sessionStorage.getItem(k) || 0);
        if (n >= 2) throw new Error('Workday kept saying "Something went wrong" after two refreshes');
        sessionStorage.setItem(k, String(n + 1));
        ctx.log('Workday said "Something went wrong" — refreshing the page', "warn");
        await ctx.save();
        location.reload();
        await sleep(1e4);
        return "stop";
      }
      default:
        ctx.run.attempts++;
        if (ctx.run.attempts > 5) throw new NeedsHuman("Unrecognised page. Move to the next step yourself, then click Resume.");
        await sleep(1500);
        return "continue";
    }
  }
  async function loop(run) {
    if (active) return;
    active = true;
    setAbort(false);
    const ctx = await buildCtx(run);
    try {
      for (let iter = 0; iter < 120; iter++) {
        await waitStable();
        const page = detectPage();
        if (page !== run.page) {
          if (run.page !== "unknown" && !run.done.includes(run.page)) run.done.push(run.page);
          run.page = page;
          run.attempts = 0;
          resetHandled();
          run.flags = run.flags.filter((f) => f.page !== page);
          ctx.log(`Page: ${page}${activeStepName() ? ` (${activeStepName()})` : ""}`);
          hooks.onPage?.(run);
        }
        ctx.page = page;
        await ctx.save();
        const r = await handlePage(ctx, page);
        if (r === "stop") return;
      }
      throw new NeedsHuman("Stopped after too many steps — check the page, then click Resume.");
    } catch (err) {
      if (err instanceof Aborted) {
        run.status = "idle";
        run.pauseReason = void 0;
        ctx.log("Stopped");
      } else if (err instanceof NeedsHuman) {
        run.status = "paused";
        run.pauseReason = err.reason;
        ctx.log(`Paused: ${err.reason}`, "warn");
        notify("Workday autopilot needs you", err.reason);
      } else {
        run.status = "error";
        run.pauseReason = err.message;
        ctx.log(`Error: ${err.message}`, "error");
      }
      await saveRun(run);
      broadcast(run);
      hooks.onFinish?.(run, run.status === "paused" ? "paused" : run.status === "error" ? "error" : "stopped");
    } finally {
      active = false;
    }
  }
  async function submitApplication(ctx, btn) {
    ctx.log("Submitting the application");
    await humanClick(btn);
    await sleep(500);
    const outcome = await waitFor(() => detectPage() === "submitted" ? "done" : errorMessages().length ? "error" : null, 3e4, 250).catch(
      () => "timeout"
    );
    if (outcome === "done" || outcome === "timeout" && detectPage() !== "review" && !errorMessages().length) {
      await markSubmitted(ctx.run);
      return "stop";
    }
    ctx.run.attempts++;
    const errs = errorMessages().map((e) => e.text);
    ctx.log(`Submit didn't go through${errs.length ? `: ${errs.join(" | ").slice(0, 300)}` : " (no confirmation yet)"}`, "warn");
    if (ctx.run.attempts > 2) throw new NeedsHuman(`Submit didn't go through: ${errs.join("; ").slice(0, 400) || "no confirmation from Workday"}`);
    return "continue";
  }
  async function markSubmitted(run) {
    if (run.status === "done") return;
    const job = run.jobKey ? await getJob(run.jobKey) : null;
    const docs = run.jobKey ? await getDocs(run.jobKey) : null;
    await recordApplication({
      jobKey: run.jobKey ?? `${run.tenantHost}|unknown`,
      tenantHost: run.tenantHost,
      reqId: job?.reqId ?? "",
      title: job?.title ?? document.title,
      submittedAt: Date.now(),
      cvFile: docs?.cv.fileName,
      coverLetterFile: docs?.coverLetter?.fileName,
      url: job?.url ?? location.href
    });
    run.status = "done";
    run.pauseReason = void 0;
    run.log.push({ at: Date.now(), level: "info", msg: "Application submitted — logged to your tracker" });
    await saveRun(run);
    broadcast(run);
    notify("Application submitted", job?.title ?? "Workday application");
    hooks.onFinish?.(run, "submitted");
  }
  function watchForSubmission() {
    if (submitWatcher) return;
    submitWatcher = window.setInterval(async () => {
      if (detectPage() !== "submitted") return;
      window.clearInterval(submitWatcher);
      submitWatcher = void 0;
      const run = await getRun(tenantHost());
      if (run) await markSubmitted(run);
    }, 1500);
  }
  async function startRun(jobKey) {
    const host2 = tenantHost();
    const run = newRun(host2, jobKey ?? null);
    await saveRun(run);
    void loop(run);
    return run;
  }
  async function resumeRun() {
    const host2 = tenantHost();
    const run = await getRun(host2) ?? newRun(host2, null);
    for (const f of run.flags) {
      const c = qa('[data-automation-id^="formField-"]').find((x) => isVisible(x) && labelOf(x) === f.label);
      const v = c ? readValue(c) : "";
      if (v && !/date|resume|cv|file/i.test(f.label)) {
        await rememberAnswer(f.label, v);
        run.log.push({ at: Date.now(), level: "info", msg: `Saved your answer for "${f.label}"${SENSITIVE_RX2.test(f.label) ? " (sensitive — reused only for this exact question)" : ""}` });
      }
    }
    run.flags = [];
    run.status = "running";
    run.pauseReason = void 0;
    run.attempts = 0;
    if (detectPage() === "signIn" || detectPage() === "createAccount") {
      run.authAttempts = 0;
      run.createAttempts = 0;
    }
    resetHandled();
    await saveRun(run);
    void loop(run);
    return run;
  }
  async function stopRun() {
    setAbort(true);
    const run = await getRun(tenantHost());
    if (run && !active) {
      run.status = "idle";
      await saveRun(run);
      broadcast(run);
    }
  }
  async function autoResume() {
    const run = await getRun(tenantHost());
    if (!run) return;
    renderOverlay(run);
    if (run.status === "review") watchForSubmission();
    if (run.status === "running" && Date.now() - run.updatedAt < 30 * 6e4) {
      await waitStable(800);
      void loop(run);
    }
  }
  setOverlayHandlers({ resume: () => void resumeRun(), stop: () => void stopRun() });
  function isActive() {
    return active;
  }

  // src/ua/entry.ts
  var TOP = window.top === window.self;
  var ST = chrome.storage.local;
  var MODE_KEY = "uaWdRun";
  var RESULT_KEY = "uaWdResult";
  var MODE_TTL = 20 * 6e4;
  var LOG_KEY = "ua_wd_engine_log";
  var LOGIN_KEY = "ua_wd_login";
  var CV_KEY = "ua_wd_cv_profile";
  var say = (msg) => {
    console.info(`[UA][WD-Engine] ${msg}`);
    try {
      window.__uaJrLine?.("engine", msg);
    } catch {
    }
  };
  var logShown = 0;
  var W = window;
  function within(p, ms) {
    return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  }
  function readMode() {
    try {
      const m = JSON.parse(sessionStorage.getItem(MODE_KEY) || "null");
      return m && Date.now() - m.startedAt < MODE_TTL ? m : null;
    } catch {
      return null;
    }
  }
  function writeMode(m) {
    try {
      sessionStorage.setItem(MODE_KEY, JSON.stringify(m));
    } catch {
    }
  }
  function clearMode() {
    try {
      sessionStorage.removeItem(MODE_KEY);
    } catch {
    }
  }
  function readResult(jobId) {
    try {
      const r = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null");
      return r && r.jobId === jobId ? r : null;
    } catch {
      return null;
    }
  }
  function writeResult(r) {
    try {
      sessionStorage.setItem(RESULT_KEY, JSON.stringify(r));
    } catch {
    }
  }
  var assistAllowed = false;
  var assistSwitch = false;
  var ASSIST_KEYS = ["ua_aa", "ua_wd_assist", "ua_wd_engine_off"];
  function readAssist() {
    ST.get(ASSIST_KEYS).then((d) => {
      assistSwitch = d.ua_aa === true && d.ua_wd_assist !== false && d.ua_wd_engine_off !== true;
      if (!assistSwitch && isActive() && !readMode()) void stopRun();
    }, () => {
    });
  }
  readAssist();
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && ASSIST_KEYS.some((k) => k in c)) readAssist();
  });
  var assistOn = () => assistAllowed && assistSwitch;
  function makePassword() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const r = crypto.getRandomValues(new Uint32Array(12));
    return "Ua" + Array.from(r, (n) => abc[n % abc.length]).join("") + "!7q";
  }
  function siteKey(host2 = location.hostname) {
    return host2.toLowerCase().replace(/^www\./, "").replace(/\.wd\d+\./, ".").replace(/\.myworkdaysite\.com$/, ".myworkdayjobs.com");
  }
  async function workdayLogin() {
    const d = await ST.get([LOGIN_KEY, "ua_app_password", "ua_app_email", "WORKDAY_SIGNUP_INFORMATION", "ua_ats_logins", "ua_wd_site_pw"]);
    const login = Object.assign({ sites: {} }, d[LOGIN_KEY] || {});
    const k = siteKey();
    const site = (d.ua_ats_logins || {})[k];
    if (site && site.email && site.password) return { email: site.email, password: site.password, login: { ...login, sites: { ...login.sites, [tenantHost()]: { state: "account" } } } };
    const known = (d.ua_wd_site_pw || {})[k];
    let password = known || d.ua_app_password || "";
    if (!password) {
      try {
        const jr = typeof d.WORKDAY_SIGNUP_INFORMATION === "string" ? JSON.parse(d.WORKDAY_SIGNUP_INFORMATION) : d.WORKDAY_SIGNUP_INFORMATION;
        password = jr && jr.password || "";
      } catch {
      }
    }
    if (!password) {
      password = makePassword();
      await ST.set({ ua_app_password: password });
    }
    const email = d.ua_app_email || (await uaProfile()).email || "";
    return { email, password, login };
  }
  async function noteSite(state) {
    try {
      const d = await ST.get(LOGIN_KEY);
      const login = Object.assign({ sites: {} }, d[LOGIN_KEY] || {});
      login.sites = Object.assign({}, login.sites, { [tenantHost()]: { state, ts: Date.now() } });
      await ST.set({ [LOGIN_KEY]: login });
    } catch {
    }
  }
  function createTried(host2, add = false) {
    try {
      const set2 = new Set(JSON.parse(sessionStorage.getItem("uaWdCreateTried") || "[]"));
      if (add && !set2.has(host2)) sessionStorage.setItem("uaWdCreateTried", JSON.stringify([...set2, host2]));
      return set2.has(host2);
    } catch {
      return add;
    }
  }
  async function answerWd(msg) {
    switch (msg.type) {
      case "wd:cred:get": {
        const { email, password, login } = await workdayLogin();
        const host2 = String(msg.tenantHost || tenantHost());
        const site = (login.sites || {})[host2] || {};
        const master = email && password ? { email, password } : null;
        if (site.state === "account" || site.state === "verify") return { cred: master, master };
        const page = detectPage();
        if (page === "createAccount") createTried(host2, true);
        if (page === "signIn" && !createTried(host2)) return { cred: null, master: null };
        return { cred: null, master };
      }
      case "wd:cred:set":
        await noteSite("account");
        return { ok: true };
      case "wd:cred:generate":
        return { password: (await workdayLogin()).password };
      case "wd:trustedType":
        return { ok: false };
      case "wd:llm":
        return llmStandIn(String(msg.prompt || ""));
      case "wd:progress":
        try {
          W.__uaWdProgress?.(msg.state?.page || "");
        } catch {
        }
        try {
          const log = msg.state && msg.state.log || [];
          for (const l of log.slice(Math.max(0, Math.min(logShown, log.length)))) say(`${l.level && l.level !== "info" ? l.level + ": " : ""}${l.msg}`);
          logShown = log.length;
        } catch {
        }
        return void 0;
      default:
        return void 0;
    }
  }
  function listIn(prompt) {
    const m = prompt.match(/OPTIONS: (\[[\s\S]*?\])\s*(\n[A-Z]+:|$)/);
    try {
      return m ? JSON.parse(m[1]) : [];
    } catch {
      return [];
    }
  }
  async function llmStandIn(prompt) {
    try {
      const q2 = prompt.match(/^QUESTION: (.*)$/m);
      if (q2 && typeof W.__uaWdGuess === "function") {
        const kind = (prompt.match(/^CONTROL: (.*)$/m) || [])[1] || "text";
        const a = await W.__uaWdGuess(q2[1].trim(), kind.trim(), listIn(prompt));
        if (a) return { ok: true, text: JSON.stringify({ answer: String(a), confidence: 0.8 }) };
      }
      const v = prompt.match(/^VALUE: (.*)$/m);
      if (v && typeof W.__uaWdPick === "function") {
        const field2 = (prompt.match(/^FIELD: (.*)$/m) || [])[1] || "";
        const o = await W.__uaWdPick(v[1].trim(), field2.trim(), listIn(prompt));
        return { ok: true, text: JSON.stringify({ option: o || null }) };
      }
    } catch {
    }
    return { ok: false, error: "no answer" };
  }
  (function routeEngineMessages() {
    if (!TOP || !isWorkdayHost()) return;
    const rt = chrome.runtime;
    const orig = rt.sendMessage.bind(rt);
    rt.sendMessage = function(msg, ...rest) {
      if (msg && typeof msg.type === "string" && msg.type.startsWith("wd:")) return answerWd(msg);
      return orig(msg, ...rest);
    };
  })();
  function parse(v) {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return {};
      }
    }
    return v && typeof v === "object" ? v : {};
  }
  async function uaProfile() {
    const d = await ST.get(["ua_profile", "candidateDetails", "userDetails"]);
    return { ...parse(d.userDetails), ...parse(d.candidateDetails), ...parse(d.ua_profile) };
  }
  function pick(o, ...keys) {
    for (const k of keys) {
      const v = o[k];
      if (v != null && String(v).trim() && typeof v !== "object") return String(v).trim();
    }
    return "";
  }
  function ym(v) {
    const s = String(v ?? "").trim();
    if (!s || /present|current|now/i.test(s)) return "";
    let m = s.match(/^(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
    if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
    const t = Date.parse(s);
    if (!Number.isNaN(t) && /[a-z]/i.test(s)) {
      const dt = new Date(t);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    }
    m = s.match(/\b(19|20)\d{2}\b/);
    return m ? `${m[0]}-01` : "";
  }
  function listOf(s, keys) {
    for (const k of keys) {
      const v = typeof s[k] === "string" ? parse(s[k]) : s[k];
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
    }
    return [];
  }
  function historyFrom(s) {
    const work = listOf(s, ["work_experience", "work_experiences", "experiences", "experience", "employment_history", "work_history", "employments"]).map((w, i) => {
      const endRaw = w.end_date ?? w.endDate ?? w.to ?? w.end ?? "";
      const end = ym(endRaw);
      return {
        id: `w${i + 1}`,
        title: pick(w, "title", "job_title", "designation", "position", "role"),
        company: pick(w, "company", "company_name", "employer", "organization", "organisation"),
        location: pick(w, "location", "city"),
        start: ym(w.start_date ?? w.startDate ?? w.from ?? w.start),
        end: end || void 0,
        current: !!(w.is_current ?? w.current ?? w.currently_working ?? w.currently_work_here) || !end && /present|current|now/i.test(String(endRaw)),
        bullets: String(w.description ?? w.summary ?? w.responsibilities ?? "").split(/\n+|•/).map((x) => x.replace(/^[\s\-*]+/, "").trim()).filter(Boolean).slice(0, 6)
      };
    }).filter((w) => w.title && w.company && w.start);
    const education = listOf(s, ["education", "educations", "education_history", "academics", "qualifications"]).map((e, i) => ({
      id: `e${i + 1}`,
      school: pick(e, "school", "school_name", "institution", "institute", "university", "college"),
      degree: pick(e, "degree", "degree_name", "qualification", "level"),
      field: pick(e, "field_of_study", "field", "major", "specialization", "course"),
      start: ym(e.start_date ?? e.startDate ?? e.from ?? e.start),
      end: ym(e.end_date ?? e.endDate ?? e.to ?? e.end ?? e.graduation_date) || void 0
    })).filter((e) => e.school);
    return { work, education };
  }
  var DIAL = {
    "1": "United States of America",
    "44": "United Kingdom",
    "353": "Ireland",
    "234": "Nigeria",
    "91": "India",
    "49": "Germany",
    "33": "France",
    "61": "Australia",
    "27": "South Africa",
    "254": "Kenya",
    "233": "Ghana",
    "31": "Netherlands",
    "34": "Spain",
    "39": "Italy",
    "351": "Portugal",
    "48": "Poland",
    "46": "Sweden",
    "47": "Norway",
    "45": "Denmark",
    "41": "Switzerland",
    "43": "Austria",
    "32": "Belgium",
    "971": "United Arab Emirates",
    "966": "Saudi Arabia",
    "65": "Singapore",
    "64": "New Zealand",
    "86": "China",
    "81": "Japan",
    "55": "Brazil",
    "52": "Mexico",
    "20": "Egypt",
    "63": "Philippines",
    "92": "Pakistan",
    "90": "Turkey"
  };
  var DIAL_CODES = Object.keys(DIAL).sort((a, b) => b.length - a.length);
  var ISO2 = {
    US: "United States of America",
    USA: "United States of America",
    GB: "United Kingdom",
    UK: "United Kingdom",
    IE: "Ireland",
    NG: "Nigeria",
    IN: "India",
    DE: "Germany",
    FR: "France",
    AU: "Australia",
    CA: "Canada",
    ZA: "South Africa",
    NL: "Netherlands",
    ES: "Spain",
    IT: "Italy",
    PT: "Portugal",
    PL: "Poland",
    AE: "United Arab Emirates",
    SG: "Singapore"
  };
  function splitPhone(raw, defCode) {
    const s = String(raw || "").trim();
    const digits = s.replace(/[^\d]/g, "");
    if (/^(\+|00)/.test(s)) {
      const d = s.startsWith("00") ? digits.slice(2) : digits;
      const sep = s.match(/^\(?(?:\+|00)(\d{1,3})\)?[\s.\-)]/);
      const code = sep ? sep[1] : DIAL_CODES.find((c) => d.startsWith(c)) || "";
      return { code, national: d.slice(code.length).replace(/^0+/, "") };
    }
    return { code: defCode, national: digits.replace(/^0+/, "") };
  }
  function properCase(name) {
    const s = String(name || "").trim();
    if (!s || s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
    return s.toLowerCase().replace(new RegExp("(^|[\\s'’\\-])(\\p{L})", "gu"), (_m, sep, ch) => sep + ch.toUpperCase());
  }
  function declineOr(v) {
    const s = String(v || "").trim();
    return !s || /prefer not|decline|do not wish|don'?t wish|not to say/i.test(s) ? "decline" : s;
  }
  function yesNoDecline(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s || /prefer not|decline|wish/i.test(s)) return "decline";
    if (/^(no|i do not|i don'?t|not a|none)/.test(s)) return "no";
    if (/^(yes|i have|i am)/.test(s)) return "yes";
    return "decline";
  }
  async function buildProfile() {
    const s = await uaProfile();
    const rawCountry = pick(s, "country", "location_country", "country_name");
    const country = ISO2[rawCountry.toUpperCase()] || rawCountry;
    const ph = splitPhone(pick(s, "phone", "mobile", "phone_number"), pick(s, "phoneCountryCode", "phone_country_code", "mobile_code").replace(/\D/g, ""));
    const hist = historyFrom(s);
    if (!hist.work.length && pick(s, "current_title", "title") && pick(s, "current_company", "company")) {
      const y = pick(s, "work_start_year");
      hist.work.push({
        id: "w1",
        title: pick(s, "current_title", "title"),
        company: pick(s, "current_company", "company"),
        location: pick(s, "city"),
        start: y ? `${y}-01` : "",
        end: void 0,
        current: true,
        bullets: []
      });
      if (!hist.work[0].start) hist.work.length = 0;
    }
    if (!hist.education.length && pick(s, "school", "university")) {
      const g = pick(s, "graduation_year", "grad_year");
      hist.education.push({ id: "e1", school: pick(s, "school", "university"), degree: pick(s, "degree"), field: pick(s, "major"), start: "", end: g ? `${g}-06` : void 0 });
    }
    const visa = pick(s, "visa_status", "sponsorship").toLowerCase();
    const base = normalizeProfile({
      personal: {
        firstName: pick(s, "first_name", "firstName", "given_name"),
        lastName: pick(s, "last_name", "lastName", "family_name", "surname"),
        preferredName: pick(s, "preferred_name"),
        email: pick(s, "email", "email_address"),
        phone: { countryName: DIAL[ph.code] || country, countryCode: ph.code ? `+${ph.code}` : "", number: ph.national, deviceType: "Mobile" },
        address: {
          line1: pick(s, "address", "address_line_1", "address1", "street"),
          line2: pick(s, "address_line_2", "address2"),
          city: pick(s, "city"),
          region: pick(s, "state", "region", "province", "county"),
          postalCode: pick(s, "postal_code", "zip", "postcode"),
          country
        },
        linkedin: pick(s, "linkedin", "linkedin_profile_url", "linkedin_url"),
        website: pick(s, "website", "website_url", "portfolio"),
        github: pick(s, "github", "github_url")
      },
      summary: pick(s, "summary", "bio"),
      skills: (Array.isArray(s.skills) ? s.skills : String(s.skills || "").split(",")).map((x) => String(typeof x === "object" ? x?.name ?? "" : x).trim()).filter(Boolean).slice(0, 30),
      languages: String(s.languages || "").split(/[,;]/).map((l) => l.trim()).filter(Boolean).map((language, i) => ({ language, proficiency: i === 0 ? "Native" : "Fluent", native: i === 0 })),
      ...hist,
      answers: {
        authorizedCountries: country ? [country] : [],
        needsSponsorship: /require|need|yes/.test(visa) && !/not require|no sponsorship|does not/.test(visa),
        salaryExpectation: pick(s, "expected_salary", "salary"),
        noticePeriod: pick(s, "notice_period", "notice"),
        earliestStartDate: pick(s, "availability", "start_date"),
        willingToRelocate: true,
        openToHybrid: true,
        openToOnsite: true,
        source: "LinkedIn",
        previouslyWorkedHere: false
      },
      eeo: {
        gender: declineOr(pick(s, "gender")),
        hispanicOrLatino: "decline",
        ethnicity: declineOr(pick(s, "ethnicity", "race")),
        veteran: declineOr(pick(s, "veteran")),
        disability: yesNoDecline(pick(s, "disability"))
      }
    });
    const imported = await getProfile().catch(() => null);
    const p = imported && (imported.work.length || imported.personal.firstName) ? imported : base;
    if (p !== base) {
      const fillIn = (a, b) => {
        for (const k of Object.keys(b)) {
          if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) fillIn(a[k] ??= {}, b[k]);
          else if (a[k] === "" || a[k] == null || Array.isArray(a[k]) && !a[k].length) a[k] = b[k];
        }
      };
      fillIn(p, base);
    }
    cvReady = Promise.resolve();
    if (p.work.length <= 1) {
      cvReady = readCvProfile().then((cv) => {
        if (!cv || cv.work.length <= p.work.length) return;
        p.work = cv.work;
        if (!p.education.length) p.education = cv.education;
        if (!p.skills.length) p.skills = cv.skills;
        if (!p.languages.length) p.languages = cv.languages;
        if (!p.summary) p.summary = cv.summary;
      }, () => void 0);
    }
    for (const k of ["firstName", "lastName", "preferredName"]) p.personal[k] = properCase(p.personal[k] || "");
    return p;
  }
  async function savedCv() {
    const d = await ST.get(["ua_resumes", "ua_active_resume", "ua_resume_data"]);
    const list = Array.isArray(d.ua_resumes) ? d.ua_resumes : [];
    const r = list[d.ua_active_resume || 0] || list[0] || d.ua_resume_data;
    if (!r || !r.base64) return void 0;
    const base64 = String(r.base64).split(",").pop() || "";
    return { fileName: r.fileName || r.name || "Resume.pdf", mime: r.mimeType || "application/pdf", base64 };
  }
  var cvReady = Promise.resolve();
  var cvReading = null;
  async function readCvProfile() {
    return cvReading ??= (async () => {
      const doc = await savedCv();
      if (!doc) return null;
      const sig = `${doc.fileName}|${doc.base64.length}|${doc.base64.slice(-32)}`;
      const { [CV_KEY]: cached } = await ST.get(CV_KEY);
      if (cached && cached.sig === sig && cached.profile) return cached.profile;
      if (!W.__ohCv) {
        await within(chrome.runtime.sendMessage({ type: "UA_WD_CV_LOAD" }), 15e3).catch(() => null);
        for (let i = 0; i < 40 && !W.__ohCv; i++) await new Promise((r2) => setTimeout(r2, 100));
      }
      if (!W.__ohCv) return null;
      const r = await within(W.__ohCv.read(doc.base64, doc.mime), 3e4).catch(() => null);
      if (!r || !r.profile) return null;
      const prof = r.profile;
      await ST.set({ [CV_KEY]: { sig, at: Date.now(), roles: prof.work.length, profile: prof } });
      say(`read your CV: ${prof.work.length} role(s), ${prof.education.length} education, ${prof.skills.length} skill(s)`);
      return prof;
    })().finally(() => setTimeout(() => {
      cvReading = null;
    }, 5e3));
  }
  var SETTINGS = {
    ...DEFAULT_WD_SETTINGS,
    consentCreateAccountTerms: true,
    // queue runs: nobody at the PC to tick them
    consentDisclosureTerms: true,
    useMasterPassword: true,
    // one password for every Workday site
    requireDocApproval: false,
    llmAnswers: true,
    // answered by this extension's deciders (llmStandIn), not an AI
    trustedInputFallback: false,
    fieldDelayMs: 40,
    fallbackToMasterCv: true,
    externalAutoRequest: false
  };
  var ASSIST_SETTINGS = () => ({ ...SETTINGS, fieldDelayMs: 10 });
  async function hostAnswer(label, kind, options, mode) {
    try {
      const f = W.__uaWdAnswer;
      const a = typeof f === "function" ? await f(label, kind, options) : null;
      if (a) return String(a);
      if (mode.queue && SENSITIVE_RX2.test(label) && typeof W.__uaWdGuess === "function") {
        const g = await W.__uaWdGuess(label, kind, options);
        return g ? String(g) : null;
      }
      return null;
    } catch {
      return null;
    }
  }
  async function installHooks(mode) {
    logShown = 0;
    const profile = await buildProfile();
    let cv = null;
    accountNoted = false;
    setHooks({
      profile: async () => profile,
      settings: async () => mode.assist ? ASSIST_SETTINGS() : SETTINGS,
      masterCv: () => cv ??= savedCv().catch(() => void 0),
      autoSubmit: () => mode.submit,
      ...mode.assist ? { advance: () => false, keepExisting: () => true } : {},
      answer: (label, kind, options) => hostAnswer(label, kind, options, mode),
      onPage: (run) => onPage(run),
      beforeExperience: () => within(cvReady, 3e4).then(() => void 0),
      onFinish: (run, outcome) => void finish(mode, run, outcome)
    });
  }
  var AUTH_PAGES = ["signIn", "createAccount", "verifyEmail"];
  var accountNoted = false;
  var lastPage = "";
  var lastActive = 0;
  var bootUntil = 0;
  function onPage(run) {
    lastPage = run.page;
    if (!accountNoted && !AUTH_PAGES.includes(run.page) && run.done.some((p) => p === "signIn" || p === "createAccount")) {
      accountNoted = true;
      void noteSite("account");
    }
    try {
      W.__uaWdProgress?.(run.page);
    } catch {
    }
  }
  function plainReason(run, outcome) {
    if (run.flags.length) {
      const labels = run.flags.map((f) => f.label).join("; ");
      return `${run.flags.length} question${run.flags.length === 1 ? "" : "s"} it could not answer: ${labels}`.slice(0, 240);
    }
    if (outcome === "review") return "filled, but no Submit button on Review";
    return (run.pauseReason || "").replace(/,?\s*then click Resume\.?/gi, "").replace(/\s+:/, ":").trim();
  }
  async function remember(run, outcome, mode) {
    try {
      const d = await ST.get(LOG_KEY);
      const list = Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : [];
      list.unshift({
        at: Date.now(),
        host: run.tenantHost,
        url: location.href,
        queue: mode.queue,
        outcome,
        page: run.page,
        reason: run.pauseReason || "",
        flags: run.flags.map((f) => `${f.label}: ${f.reason}`),
        log: run.log.slice(-40).map((l) => `${l.level === "info" ? "" : l.level + ": "}${l.msg}`)
      });
      await ST.set({ [LOG_KEY]: list.slice(0, 30) });
    } catch {
    }
  }
  async function finish(mode, run, outcome) {
    if (mode.assist) return;
    clearMode();
    writeResult({ jobId: mode.jobId, outcome, page: run.page, at: Date.now(), reason: plainReason(run, outcome) });
    say(`${outcome}${run.pauseReason ? ": " + run.pauseReason : ""}`);
    await remember(run, outcome, mode);
    const reason = run.pauseReason || "";
    if (run.page === "verifyEmail") await noteSite("verify");
    else if (outcome !== "submitted" && /sign-in was rejected|already have an account|failed twice/i.test(reason)) await noteSite("other-password");
  }
  async function startJob(jobId) {
    const id = String(jobId || "");
    if (!id) return;
    const m = readMode();
    if (m && m.jobId === id && !m.assist || readResult(id)) return;
    if (isActive()) {
      await stopRun();
      for (let i = 0; i < 50 && isActive(); i++) await new Promise((r) => setTimeout(r, 100));
    }
    const mode = { queue: true, submit: true, startedAt: Date.now(), jobId: id };
    writeMode(mode);
    bootUntil = Date.now() + 3e4;
    say(`applying (queue job ${id.slice(0, 40)})`);
    try {
      for (let i = 0; i < 40 && !hasWorkdayApp(); i++) await new Promise((r) => setTimeout(r, 500));
      await installHooks(mode);
      await startRun(null);
    } catch (e) {
      clearMode();
      writeResult({ jobId: id, outcome: "error", reason: e?.message || String(e), at: Date.now() });
    }
  }
  W.__uaWdEngine = {
    version: 1,
    isWorkday: () => TOP && isWorkdayHost(),
    startJob: (jobId) => void startJob(jobId),
    result: (jobId) => readResult(String(jobId || "")),
    /** Still working on this job (or about to resume it after a reload). A run
     *  that ended without reporting (the engine stops quietly on, e.g., a Submit
     *  button outside Review) is recorded here as "stopped" on its page, so the
     *  host carries on instead of waiting for an outcome that never comes. */
    running: (jobId) => {
      const id = String(jobId || "");
      if (isActive()) {
        lastActive = Date.now();
        return true;
      }
      const m = readMode();
      if (!m || m.jobId !== id || m.assist) return false;
      const ran = lastActive >= m.startedAt;
      if (ran ? Date.now() - lastActive < 2500 : Date.now() < bootUntil || Date.now() - m.startedAt < 8e3) return true;
      clearMode();
      if (!readResult(id)) writeResult({ jobId: id, outcome: "stopped", page: lastPage || detectPage(), at: Date.now(), reason: "the engine stopped on this page without finishing" });
      return false;
    },
    page: () => lastPage || detectPage(),
    stop: () => {
      clearMode();
      void stopRun();
    },
    /** Fully Automated is on outside a run here: assist takes the Workday steps. */
    allowAssist: () => {
      assistAllowed = true;
      return assistOn();
    },
    assistOn,
    readCv: () => readCvProfile()
  };
  if (TOP && isWorkdayHost()) {
    const submitCountdown = (seconds = 5) => {
      if (!document.body) return;
      const host2 = document.createElement("div");
      host2.id = "ua-wd-submit-countdown";
      host2.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
      const root2 = host2.attachShadow({ mode: "open" });
      root2.innerHTML = `<style>
      .b{font:13px/1.4 Inter,system-ui,sans-serif;display:flex;align-items:center;gap:12px;padding:12px 14px;background:#12141c;color:#e6e8ef;
         border:1px solid #262a36;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
      b{font-weight:600} button{font:600 12.5px/1 inherit;font-family:inherit;height:30px;padding:0 12px;border-radius:8px;cursor:pointer;
         background:#1a1d27;color:#e6e8ef;border:1px solid #333849} button:hover{background:#20242f}
      .now{background:#6d5efc;border-color:#6d5efc;color:#fff}</style>
      <div class="b" role="status"><span>Submitting your application in <b id="n">${seconds}</b>…</span>
      <button class="now" id="go">Submit now</button><button id="x">Cancel</button></div>`;
      document.body.appendChild(host2);
      let left = seconds;
      let done = false;
      const end = (submit2) => {
        if (done) return;
        done = true;
        clearInterval(t);
        host2.remove();
        if (!submit2 || !assistOn()) {
          say("assist: submit cancelled — Review is yours");
          return;
        }
        say("assist: submitting from Review");
        const mode = { queue: false, submit: true, startedAt: Date.now(), jobId: "" };
        void installHooks(mode).then(() => startRun(null));
      };
      const t = window.setInterval(() => {
        left--;
        const n = root2.getElementById("n");
        if (n) n.textContent = String(left);
        if (left <= 0) end(true);
      }, 1e3);
      root2.getElementById("go")?.addEventListener("click", () => end(true));
      root2.getElementById("x")?.addEventListener("click", () => end(false));
    };
    const ASSIST_PAGES2 = ["resumeUpload", "myInformation", "myExperience", "questions", "voluntaryDisclosures", "selfIdentify"];
    const assisted = /* @__PURE__ */ new Set();
    setInterval(() => {
      if (!assistOn() || readMode() || isActive() || !hasWorkdayApp()) return;
      const page = detectPage();
      if (page === "review") {
        const rk = `review|${location.pathname}`;
        if (!assisted.has(rk) && !document.getElementById("ua-wd-submit-countdown")) {
          assisted.add(rk);
          submitCountdown();
        }
        return;
      }
      if (!ASSIST_PAGES2.includes(page)) return;
      const key2 = `${page}|${activeStepName()}|${location.pathname}`;
      if (assisted.has(key2)) return;
      assisted.add(key2);
      say(`assist: filling ${page}`);
      const mode = { queue: false, submit: false, assist: true, startedAt: Date.now(), jobId: "" };
      void installHooks(mode).then(() => startRun(null));
    }, 900);
    const warmCv = (tries = 0) => {
      if (!hasWorkdayApp()) {
        if (tries < 40) setTimeout(() => warmCv(tries + 1), 500);
        return;
      }
      if (!assistOn() && !readMode()) {
        if (tries < 40) setTimeout(() => warmCv(tries + 1), 1500);
        return;
      }
      void readCvProfile().catch(() => void 0);
    };
    setTimeout(() => warmCv(), 1500);
    const boot = (tries = 0) => {
      const mode = readMode();
      if (!mode || mode.assist) return;
      if (!tries) bootUntil = Date.now() + 35e3;
      if (!hasWorkdayApp()) {
        if (tries < 60) setTimeout(() => boot(tries + 1), 500);
        return;
      }
      void installHooks(mode).then(() => autoResume());
    };
    boot();
  }
})();
