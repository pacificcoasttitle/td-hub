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
