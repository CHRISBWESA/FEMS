// Generic input validators shared by modules (money/date/text/uuid). Implemented once in the finance
// module and exposed here so other modules don't import from a sibling feature module by path.
export {
  validateAmount,
  validateDate,
  validateText,
  validateOptionalUuid,
  validateRequiredUuid,
} from '../../finance/finance.validation';
