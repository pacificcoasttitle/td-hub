-- Seed FNF/Commonwealth CPL branches
-- These mirror the Westcor PCT branches but with FNF-specific agent/underwriter codes.
-- CLUP = branch_code (agent number used in SOAP calls)
-- underwriter_code = FNF underwriter short name used in SOAP envelope
--
-- NOTE: Update branch_code and underwriter_code with actual FNF agent numbers
-- once provided by FNF/Commonwealth. These are placeholder values.

INSERT INTO cpl_branches (underwriter, branch_code, branch_name, agency_name, address, city, state, zip, phone, underwriter_code, is_active)
VALUES
  ('fnf', 'PCT-CW-OR', 'Pacific Coast Title - Orange', 'Pacific Coast Title Company', '1111 E. Katella Avenue, #120', 'Orange', 'CA', '92867', '714.516.6700', 'CW', true),
  ('fnf', 'PCT-CW-GL', 'Pacific Coast Title - Glendale', 'Pacific Coast Title Company', '516 Burchett St.', 'Glendale', 'CA', '91203', '818.662-6700', 'CW', true),
  ('fnf', 'PCT-CW-OX', 'Pacific Coast Title - Oxnard', 'Pacific Coast Title Company', '1000 Town Center Drive, #300', 'Oxnard', 'CA', '93036', '805.604.4696', 'CW', true),
  ('fnf', 'PCT-CW-CC', 'Pacific Coast Title - Concord', 'Pacific Coast Title Company', '1849 Willow Pass Road, #304', 'Concord', 'CA', '94520', '925.942.4040', 'CW', true),
  ('fnf', 'PCT-CW-WV', 'Pacific Coast Title - Westlake Village', 'Pacific Coast Title Company', '2945 Townsgate Road, #200', 'Westlake Village', 'CA', '91361', '805.496.9272', 'CW', true),
  ('fnf', 'PCT-CW-SD', 'Pacific Coast Title - San Diego', 'Pacific Coast Title Company', '2655 Camino Del Rio North, #210', 'San Diego', 'CA', '92108', '619.376.6270', 'CW', true),
  ('fnf', 'PCT-CW-GR', 'Pacific Coast Title - Gold River', 'Pacific Coast Title Company', '11344 Coloma Road, Suite 840', 'Gold River', 'CA', '95670', '866-724-150', 'CW', true)
ON CONFLICT DO NOTHING;
