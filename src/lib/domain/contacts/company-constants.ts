/** Internal companyType → SoftPro UserType display value */
export const COMPANY_TYPE_MAP: Record<string, string> = {
  escrow: 'Escrow Company',
  lender: 'Lender',
  mortgage_broker: 'Mortgage Broker',
  realtor: 'Selling Agent/Broker',
};

/** SoftPro display value → internal companyType */
export const DISPLAY_TO_TYPE: Record<string, string> = {
  'Escrow Company': 'escrow',
  'Lender': 'lender',
  'Mortgage Broker': 'mortgage_broker',
  'Real Estate': 'realtor',
  'Title Company': 'realtor',
  'Other': 'realtor',
};
