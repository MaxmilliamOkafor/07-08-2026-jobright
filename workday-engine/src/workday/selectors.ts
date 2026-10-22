/**
 * Versioned map of Workday `data-automation-id`s. Each logical element lists
 * every id seen across Workday UI generations, newest first. Keep ALL selectors
 * here so drift is fixed in one place.
 */
import { Q } from "./i18n.js";

export const SELECTOR_VERSION = "2026.10";

export const AID = {
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
  pageReview: ["applyFlowReviewPage", "reviewJobApplicationPage"],
} as const;

export type AidKey = keyof typeof AID;

/** CSS selector matching any id variant for a logical element. */
export function sel(key: AidKey): string {
  return AID[key].map((id) => `[data-automation-id="${id}"]`).join(",");
}

/** Label-text fallbacks (multilingual) used when no automation id matches. */
export const LABELS: Partial<Record<AidKey, RegExp>> = {
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
  selfIdDate: /date|datum|fecha|data|日付|日期/iu,
};
