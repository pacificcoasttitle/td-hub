/** Internal companyType → SoftPro UserType display value */
export const COMPANY_TYPE_MAP: Record<string, string> = {
  escrow: 'Escrow Company',
  escrow_company: 'Escrow Company',
  lender: 'Lender',
  mortgage_broker: 'Mortgage Broker',
  realtor: 'Real Estate',
  real_estate_company: 'Selling Agent/Broker',
  title_company: 'Title Company',
  underwriter: 'Underwriter',
};

/**
 * AddCompany UserType. SoftPro accepts these four. Do not send
 * COMPANY_TYPE_MAP.realtor ("Real Estate") on create — that is a display alias
 * for synced rows, not a write value.
 */
export const ADD_COMPANY_USER_TYPE = {
  escrow: 'Escrow Company',
  escrow_company: 'Escrow Company',
  lender: 'Lender',
  mortgage_broker: 'Mortgage Broker',
  realtor: 'Selling Agent/Broker',
  real_estate_company: 'Selling Agent/Broker',
} as const;

export type AddCompanyUserType = keyof typeof ADD_COMPANY_USER_TYPE;

export const ADD_COMPANY_USER_TYPES = [
  'escrow',
  'escrow_company',
  'lender',
  'mortgage_broker',
  'realtor',
  'real_estate_company',
] as const;

export function companyTypeFlags(userType: string): {
  isEscrowCompany: boolean;
  isLender: boolean;
  isMortgageBroker: boolean;
  isRealEstateCompany: boolean;
} {
  return {
    isEscrowCompany: userType === 'escrow' || userType === 'escrow_company',
    isLender: userType === 'lender',
    isMortgageBroker: userType === 'mortgage_broker',
    isRealEstateCompany: userType === 'realtor' || userType === 'real_estate_company',
  };
}

export function persistCompanyType(userType: string): string {
  if (userType === 'escrow') return 'escrow_company';
  if (userType === 'realtor') return 'real_estate_company';
  return userType;
}

/** SoftPro display value → internal companyType */
export const DISPLAY_TO_TYPE: Record<string, string> = {
  'Escrow Company': 'escrow_company',
  'EscrowCompany': 'escrow_company',
  'Lender': 'lender',
  'Mortgage Broker': 'mortgage_broker',
  'MortgageBroker': 'mortgage_broker',
  'Real Estate': 'real_estate_company',
  'ListingAgentBroker': 'real_estate_company',
  'SellingAgentBroker': 'real_estate_company',
  'Listing Agent/Broker': 'real_estate_company',
  'Selling Agent/Broker': 'real_estate_company',
  'Title Company': 'title_company',
  'TitleCompany': 'title_company',
  'Underwriter': 'underwriter',
  'Other': 'realtor',
  escrow: 'escrow',
  realtor: 'realtor',
};
