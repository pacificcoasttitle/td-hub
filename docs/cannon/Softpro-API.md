SoftPro OrderCreationController APIs

## Authentication (adapter)

POST /api/authentication/CreateUserToken (anonymous — no X-API-KEY required)

Body:

```json
{ "UserId": "<service account, e.g. TD_Hub>", "Token": "<generated>", "TokenStatus": 1 }
```

- Registers/rotates an API key in the adapter's phpNetAuth table.
- Re-registering an existing UserId expires the prior token.

All other endpoints, once auth is enabled:

- Header: `X-API-KEY: <token>`
- Write operations (POST/PUT): include `UserId` (this exact casing) in the JSON body.

Casing note: adapter prose sometimes says "UserID"; the adapter's literal JSON uses `UserId`.

Source: SoftPro adapter team written response, May 2026.

1. Open Order
API URL:
http://100.29.181.61:3000/api/ordercreation/create
Staging: 8081
Production: 3000
Method: POST
Request:
json
{
   "baseDetails": {
       "OrderType": "Title only",
       "ProjectName": "PCT",
       "IsRushOrder": true
   },
   "personalDetails": {
       "CompanyLookupCode": "Centr20C",
       "ClientLookupCode": "FayMazCen1",
       "UserType": "EscrowCompany",
       "CompanyName": "Central Escrow Group, Inc",
       "Email": "faye.mazaheri@centralescrowgroup.com",
       "FirstName": "Faye",
       "LastName": "Mazaheri",
       "Telephone": "9493338788",
       "Address": "20 Corporate Park Suite 185",
       "City": "Irvine",
       "ZipCode": "92606",
       "EmailNotifications": true,
       "State": "",
       "SalesRep": "PCT\\awu"
   },
   "propertyDetails": [
       {
       "Address1": "660 W Vernon Ave",
       "Address2": "",
       "APNNumberParcelID": "5018-032-025",
       "Country": "Los Angeles",
       "Description": "Lot:61 Bradford&espes Figueroa&vernon Ave Tract Ex Of St Lot 61 ",
       "IsPrimaryResidence": true,
       "City": "Los Angeles",
       "Zip": "90037",
       "EscrowBriefLegalLookupCode": null,
       "EscrowBriefLegal": "Lot:61 Bradford&espes Figueroa&vernon Ave Tract Ex Of St Lot 61 ",
       "State": "CA"
   }
   ],
   "sellerDetails": {
	    "PrimaryOwnerFirstName": "Gerardo",
	    "PrimaryOwnerMiddleName": "J",
	    "PrimaryOwnerLastName": "Hernandez",
	    "SecondaryOwnerFirstName": "Yessica",
	    "SecondaryOwnerMiddleName": "S",
	    "SecondaryOwnerLastName": "Mendoza",
	    "OrganizationType": "",
	    "IsOrganization": "false"
	  },
   "transactionDetails": {
       "LookUpCodeTitleOffice": "OCT",
       "TitleOffice": "PCT\\cvirata",
       "Product": "Short Form",
       "EscrowNumber": "CEG610547-FM",
       "SalesAmount": 0.0,
       "PrimaryBorrowerFirstName": "Properties",
       "PrimaryBorrowerMiddleName": "Llc",
       "PrimaryBorrowerLastName": "Javid",
       "SecondaryBorrowerFirstName": "",
       "SecondaryBorrowerMiddleName": "",
       "SecondaryBorrowerLastName": "",
       "TransactionType": "Refinance",
       "LoanNumber": "2510014312",
       "LoanAmount": 375000.0,
       "LookUpCodeEscrowOfficer": null,
       "EscrowOfficerName": null,
       "UnderwriterLookUpCode": "WC",
       "CoverageAmount": 375000.0,
       "IsOrganization": true,
       "OrganizationType": "Limited Liability Company"
   },
   "buyersAgentDetails": {
		"CompanyLookUpCode": "C&C1475",
		"ClientLookUpCode": "LilPinC&C1",
		"Name": "Lilly Pinedo",
		"Email": "lp.processor@gmail.com",
		"Telephone": "(714) 676-6181",
		"CompanyName": "C & C Financial Corp"
	},
   "listingAgentDetails": {
		"CompanyLookUpCode": "C&C1475",
		"ClientLookUpCode": "LilPinC&C1",
		"Name": "Lilly Pinedo",
		"Email": "lp.processor@gmail.com",
		"Telephone": "(714) 676-6181",
		"CompanyName": "C & C Financial Corp"
	},
   "escrowDetails": {
		"CompanyLookUpCode": "C&C1475",
		"ClientLookUpCode": "LilPinC&C1",
		"Name": "Lilly Pinedo",
		"Email": "lp.processor@gmail.com",
		"Telephone": "(714) 676-6181",
		"CompanyName": "C & C Financial Corp"
	},
   "lenderDetails": {
		"CompanyLookUpCode": "C&C1475",
		"ClientLookUpCode": "LilPinC&C1",
		"Name": "Lilly Pinedo",
		"Email": "lp.processor@gmail.com",
		"Telephone": "(714) 676-6181",
		"CompanyName": "C & C Financial Corp"
	},
   "mortgageDetails": {
		"CompanyLookUpCode": "C&C1475",
		"ClientLookUpCode": "LilPinC&C1",
		"Name": "Lilly Pinedo",
		"Email": "lp.processor@gmail.com",
		"Telephone": "(714) 676-6181",
		"CompanyName": "C & C Financial Corp"
	}
}
Response:
json
{
   "Status": 200,
   "Message": "Order created successfully",
   "OrderNumber": "20003483-GLT",
   "data": [
       {
           "TaskId": "TASK_CODE"
       }
   ]
}
Description:
In order open API:
OrderType can have values:
1.1 Title only
1.2 Title & Escrow
1.3 Escrow only
In personalDetails, we can add the values of 4 contacts depending on the userType. It can have the values:
2.1 UserType: EscrowCompany for adding escrow details
2.2 UserType: Lender for adding lender details
2.3 UserType: ListingAgentBroker for adding listing agent details
2.4 UserType: MortgageBroker for adding mortgage broker details
The Value of this dropdown is used as a listing agent broker. For the other 3 contacts(as mentioned above), data can be sent from the contacts object shared in the order opening request.
CompanyLookupCode is the lookup code of the organization ClientLookupCode is the lookup code of the associated person
As the seller/buyer can be associated with an organization or an individual, IsOrganization is used for specifying it. Add true if it’s organisation. For borrowers, these details are mentioned in transactionDetails.
2. Add Documents (Bulk)
API URL:
http://100.29.181.61:3000/api/ordercreation/AddDocuments
Method: POST
Request:
json
[
   {
       "OrderNumber": "20001314-OCT",
       "DocumentName": "Financial Doc",
       "Id": "Doc_1",
       "FileList": [
           {
               "FolderName": "Title Docs",
               "FileURL": "http://example.com/file.pdf"
           }
       ]
   }
]
Response:
json
[
   {
       "Status": 200,
       "Message": "Success",
       "OrderNumber": "20001314-OCT",
       "Id": "Doc_1",
       "FileUploadedStatus": true
   }
]
Description: Downloads files provided by the Transaction desk URLs and attaches them to the order.

3. Get Attached Documents
API URL:
http://100.29.181.61:3000/api/ordercreation/GetAttachedDocuments
Method: GET
Parameters:
orderNumber: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       "http://100.29.181.61/SoftProIntegrate/assets/DocumentName_HHmmss.pdf"
   ]
}
Description: Retrieves a list of URLs for documents attached to a specific order.

4. Get Prelim Documents
API URL:
http://100.29.181.61:3000/api/ordercreation/GetAttachedDocumentsPrelim
Method: GET
Parameters:
orderNumber: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       "http://100.29.181.61/SoftProIntegrate/assets/PrelimDoc_HHmmss.pdf"
   ]
}
Description: Retrieves a list of URLs for preliminary title documents attached to an order.

5. Get Policy Documents
API URL:
http://100.29.181.61:3000/api/ordercreation/GetAttachedDocumentsPolicy
Method: GET
Parameters:
orderNumber: string
DocType: string (e.g., "Lender", "Owner", "Supplement")
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "FileName": "Policy Name",
           "FileUrl": "http://100.29.181.61/SoftProIntegrate/assets/Policy_HHmmss.pdf"
       }
   ]
}
Description: Retrieves a list of policy documents (Lender, Owner, Supplement) for a given order and document type.

6. Get Documents from Orders
API URL:
http://100.29.181.61:3000/api/ordercreation/GetAttachedDocumentsFromOrders
Method: GET
Parameters:
DateFrom: datetime
DateTo: datetime
Response:
json
[
   {
       "Status": 200,
       "Message": "Success",
       "OrderNumber": "20001314-OCT",
       "data": [
           "http://100.29.181.61/SoftProIntegrate/assets/Prelim_HHmmss.pdf"
       ]
   }
]
Description: Retrieves a list of attached documents for all orders within a specified date range.

7. Get Prelim Details (Structured Data)
API URL:
http://100.29.181.61:3000/api/ordercreation/GetPrelim
Method: GET
Parameters:
orderNumber: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": {
       "lien": [
           {
               "Assignee": "ABC Bank",
               "Assignor": "XYZ Lender"
           }
       ],
       "Grantee": "John Doe",
       "Grantor": "Jane Smith",
       "Restrictions": [
           {
               "RestrictionCode": "R1",
               "RestrictionComment": { "Text": "Plain text comment" }
           }
       ],
       "easements": [
           {
               "EasementID": "E1",
               "EasementTypeName": { "Text": "Utility Easement" },
               "Grantee": "City Power",
               "Grantor": "Jane Smith"
           }
       ],
       "requirements": [
           { "description": "Pay off existing lien" }
       ],
       "exceptions": [
           { "description": "Taxes for current year" }
       ]
   }
}
Description: Extracts structured data from preliminary title reports, including liens, grantees, restrictions, easements, requirements, and exceptions.

8. Add Notes
API URL:
http://100.29.181.61:3000/api/ordercreation/AddNotes
Method: POST
Request:
json
[
   {
       "OrderNumber": "20001314-OCT",
       "Text": "Sample Note Text",
       "Id": "Note_1"
   }
]
Response:
json
[
   {
       "Status": 200,
       "Message": "Note added successfully to the file",
       "OrderNumber": "20001314-OCT",
       "Id": "Note_1"
   }
]
Description: Adds one or more text notes to a specific order.

9. Add/Update Task
API URL:
http://100.29.181.61:3000/api/ordercreation/AddTask
Method: POST
Request:
json
[
   {
       "OrderNumber": "20001314-OCT",
       "TaskId": "TASK_CODE"
   }
]
Response:
json
[
   {
       "Status": 200,
       "Message": "Task updated successfully in the order",
       "OrderNumber": "20001314-OCT",
       "FileUploadedStatus": true
   }
]
Description: Updates the status or adds a specific task (milestone) to an order.

10. Get Order Status List
API URL:
http://100.29.181.61:3000/api/ordercreation/GetOrderStatus
Method: GET
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       "Open",
       "Closed",
       "Cancelled"
   ]
}
Description: Returns a list of all possible order statuses (e.g., Open, Closed, Cancelled).

11. Get Marketing Representatives
API URL:
http://100.29.181.61:3000/api/ordercreation/GetOrderMarketingRep
Method: GET
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "LookUpCode": "REP1",
           "FullName": "John Sales",
           "Email": "john@sales.com",
           "Phone": "1234567890"
       }
   ]
}
Description: Retrieves a list of active marketing representatives with their lookup codes and contact details.

12. Create User
API URL:
http://100.29.181.61:3000/api/ordercreation/CreateUser
Method: POST
Request:
json
{
   "ClientLookupCode": "CODE123",
   "CompanyLookupCode": "COMP456",
   "FirstName": "John",
   "LastName": "Doe",
   "Email": "john@doe.com",
   "Phone": "1234567890",
   "UserType": "EscrowOfficer",
   "Address1": "123 Main St",
   "City": "Irvine",
   "State": "CA",
   "Zip": "92606"
}
Response:
json
{
   "Status": 200,
   "Message": "User added"
}
Description: Creates a new user in the system and associates them with an organization in the contact lookup table.

13. Update User
API URL:
http://100.29.181.61:3000/api/ordercreation/UpdateUser
Method: POST
Request:
json
{
   "ClientLookupCode": "CODE123",
   "FirstName": "John",
   "MiddleName": "Q",
   "LastName": "Doe",
   "Email": "john.new@doe.com",
   "Phone": "9876543210",
   "Address1": "456 Oak Ave",
   "City": "Irvine",
   "State": "CA",
   "Zip": "92618"
}
Response:
json
{
   "Status": 200,
   "Message": "User updated"
}
Description: Updates the profile information for an existing user based on their client lookup code.

14. Update Company
API URL:
http://100.29.181.61:3000/api/ordercreation/UpdateCompany
Method: POST
Request:
json
{
   "LookupCode": "COMP123",
   "UserType": "Lender",
   "Name": "ABC Title Company Updated",
   "Address1": "456 New St",
   "City": "Irvine",
   "State": "CA",
   "Zip": "92618",
   "Email": "new-contact@abc.com",
   "Phone": "9495551234"
}
Response:
json
{
   "Status": 200,
   "Message": "Company updated"
}
Description: Updates company details (address, contact info) in the lookup table based on the lookup code and user type.

15. Get Title and Escrow Users
API URL:
http://100.29.181.61:3000/api/ordercreation/GetTitleEscrowUsers
Method: GET
Parameters:
userType: string
LookupCode: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       "Title Officer name or list"
   ]
}
Description: Retrieves a list of users filtered by type (e.g., Title Officer, Escrow Officer) and lookup code.

16. Get Filtered Orders (Sales Report)
API URL:
http://100.29.181.61:3000/api/ordercreation/GetFilteredOrders
Method: GET
Request:
json
{
   "DateType": "Received Date",
   "DateFrom": "2024-01-01",
   "DateThrough": "2024-01-31",
   "Office": "Headquarters"
}
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": "http://100.29.181.61/SoftProIntegrate/assets/SalesReport/SalesReport_20240101_HHmmss.xls"
}
Description: Generates and returns a URL to an Excel sales report filtered by date range, type, and office.

17. Add Company
API URL:
http://100.29.181.61:3000/api/ordercreation/AddCompany
Method: POST
Request:
json
{
   "LookupCode": "COMP123",
   "Name": "ABC Title Company",
   "Address1": "123 Main St",
   "City": "Irvine",
   "State": "CA",
   "Zip": "92606",
   "Email": "contact@abc.com",
   "UserType": "Lender"
}
Response:
json
{
   "Status": 200,
   "Message": "User added"
}
Description: Adds a new company/organization to the lookup table.

18. Get Order Details
API URL:
http://100.29.181.61:3000/api/ordercreation/GetOrderDetails
Method: GET
Parameters:
OrderNumber: string
DateFrom: datetime
DateTo: datetime
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "OrderNumber": "20003483-GLT",
           "OrderStatus": "Open",
           "MarketingSource": "Referral",
           "OrderType": "Purchase",
           "TransactionType": "Resale",
           "MarketingRep": "Jane Smith",
           "Address": "123 Main St",
           "Zip": "90210",
           "City": "Los Angeles",
           "State": "CA",
           "Country": "USA",
           "TitleOfficer": "Bob Officer",
           "EscrowOfficer": "Alice Escrow",
           "SalesPrice": 500000.0,
           "ProductType": "Standard",
           "ReceivedDate": "2024-03-01",
           "CompletedDate": "",
           "ModifiedDate": "2024-03-05"
       }
   ]
}
Description: Retrieves detailed information for orders, filtered by order number or date range.

19. Milestone Notification
API URL:
http://100.29.181.61:3000/api/ordercreation/GetMilestoneNotification
Method: GET
Parameters:
orderNumber: string
TaskId: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "OrderNumber": "20003483-GLT",
   "Id": "TASK_123"
}
Description: Retrieves milestone task information for a specific order and task ID.

20. Update Order Details
API URL:
http://100.29.181.61:3000/api/ordercreation/updateOrder
Method: POST
Request:
json
{
   "orderNumber": "20003483-GLT",
   "loanDetails": {
       "loanNumber": "12345",
       "loanAmount": 250000.0
   }
}
Response:
json
{
   "Status": 200,
   "Message": "Order updated"
}
Description: Updates specific order fields, such as loan details (number and amount).

21. Get Order Contacts
API URL:
http://100.29.181.61:3000/api/ordercreation/GetOrderContacts
Method: GET
Parameters:
OrderNumber: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": {
       "buyer": {
           "PreimaryBorrower": "John Buyer",
           "SecondaryBorrower": ""
       },
       "EscrowCompanies": {
           "CompanyLookUpCode": "ESC1",
           "PersonLookupCode": "PERS1"
       },
       "Lenders": {
           "CompanyLookUpCode": "LEN1",
           "PersonLookupCode": "PERS2"
       },
       "ListingAgentBrokers": {
           "CompanyLookUpCode": "AGENT1",
           "PersonLookupCode": "PERS3"
       },
       "Sellers": {
           "PreimarySeller": "Jane Seller",
           "SecondarySeller": ""
       }
   }
}
Description: Retrieves primary and secondary contact information (Borrowers, Sellers, Escrow, Lender, Agents) for an order.

22. Get Order Fees
API URL:
http://100.29.181.61:3000/api/ordercreation/GetFees
Method: GET
Parameters:
orderNumber: string
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "InvoiceNumber": "INV-001",
           "Fees": [
               {
                   "Description": "Recording Fee",
                   "Amount": 150.0
               }
           ],
           "Total": {
               "Amount": 150.0
           }
       }
   ]
}
Description: Retrieves a breakdown of fees and invoices associated with an order.

23. Get Prelim Summary
API URL:
http://100.29.181.61:3000/api/ordercreation/GetPrelimSummary
Method: GET
Parameters:
orderNumber: string
Response:
json
{
   "Status": 200,
   "Message": "Success"
}
Description: Executes a summary check for preliminary title data associated with an order.

24. Get Orders
API URL:
http://100.29.181.61:3000/api/ordercreation/GetOrders
Method: GET
Parameters:
DateFrom: datetime
DateTo: datetime
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "OrderNumber": "20003483-GLT",
           "OrderStatus": "Open",
           "LastModifiedOn": "2024-03-05",
           "CompletedDate": ""
       }
   ]
}
Description: Retrieves a list of orders with their current status and last modification date within a specified date range.

PowerBI APIs
1. Create Excel (Revenue Data)
API URL:
http://100.29.181.61:3000/api/powerbi/createExcel
Staging: 8081
Production: 3000
Method: GET
Parameters:
userPostedDate: string (optional, format: dd-MM-yyyy, e.g., 06-11-2025)
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "Number": "20003483-GLT",
           "TransactionDate": "2025-11-06T00:00:00",
           "PayorPayeeCode": "...",
           "PayorPayee": "...",
           "Year": 2025,
           "BillCode": "TPC",
           "BillCodeCategory": "...",
           "TransferToFrom_LedgerName": "...",
           "EscrowAssistant": "...",
           "EscrowOfficerName": "...",
           "TitleOfficerName": "...",
           "MarketingSource": "...",
           "MainContact": "...",
           "TransType": "...",
           "OrderType": "...",
           "Kind": "...",
           "OwnershipProfile": "...",
           "ProductType": "...",
           "TitleOffice": "...",
           "EscrowOffice": "...",
           "SalesRep": "...",
           "ReferenceNumber": "...",
           "PropertyType": "...",
           "CommissionRate": 0.0,
           "TitleCompany": "...",
           "GLCode": "...",
           "BillCodeDesc": "...",
           "ChargeDescription": "...",
           "Underwriter": "...",
           "SellingAgent": "...",
           "ListingAgent": "...",
           "County": "...",
           "City": "...",
           "PropState": "...",
           "Zip": "...",
           "Address2": "...",
           "Address1": "...",
           "FullAddress": "...",
           "2ndLender": "...",
           "1stLender": "...",
           "EscrowOfficer": "...",
           "EOfficeLookUpCode": "...",
           "TOfficeLookUpCode": "...",
           "DisbursementDate": "...",
           "EscrowClosedDate": "...",
           "ReceivedDate": "...",
           "SumAmount": 1250.0
       }
   ]
}
Description: Extracts detailed revenue and premium data from the Power BI dashboard.
The API filters data based on the month of the provided userPostedDate.
It specifically includes entries where BillCode is one of: TPC, TPW, UPRE, TSGW, or ESC.
The response includes a list of rows containing order numbers, transaction dates, contact names, and financial amounts.
2. Get Opening Data
API URL:
http://100.29.181.61:3000/api/powerbi/getOpeningData
Staging: 8081
Production: 3000
Method: GET
Parameters:
userPostedDate: string (optional, format: dd-MM-yyyy, e.g., 06-11-2025)
Response:
{
   "Status": 200,
    "Message": "Success",
    "FileUploadedStatus": false,
    "data": [
        {
            "[Year]": "Previous (2025)",
            "[Number]": "20009042-GLT",
            "[TransType]": "Purchase",
            "[OrderType]": "Title only",
            "[ProductType]": "Residential Resale",
            "[EscrowAssistant]": "",
            "[EscrowOfficerName]": "",
            "[MarketingSource]": "",
            "[MainContact]": "",
            "[ProfileName]": "",
            "[RedcdDate]": "2025-10-09T14:47:29",
            "[SalesRep]": "",
            "[SettDate]": "2025-12-03T08:00:00",
            "[TitleOfficer]": "Eddie LasMarias"
        },
        {
            "[Year]": "Previous (2025)",
            "[Number]": "20009804-GLT",
            "[TransType]": "Purchase",
            "[OrderType]": "Title only",
            "[ProductType]": "Residential Resale",
            "[EscrowAssistant]": "",
            "[EscrowOfficerName]": "",
            "[MarketingSource]": "",
            "[MainContact]": "",
            "[ProfileName]": "",
            "[RedcdDate]": "2025-10-27T10:45:34",
            "[SalesRep]": "",
            "[SettDate]": "2025-12-22T08:00:00",
            "[TitleOfficer]": ""
        }	
    ]
}
Description: Extracts detailed order opening data from the Power BI dashboard.
  LookUpController APIs

1. Get LookUp Table
API URL:
http://100.29.181.61:3000/api/lookup/GetLookUpTable
Staging: 8081
Production: 3000
Method: GET
Parameters:
userType: string (e.g., "Title Officer", "Escrow Officer", "Lender", etc.)
Response:
json
{
   "Status": 200,
   "Message": "Success",
   "data": [
       {
           "Code": "ABC1",
           "Name": "ABC Title Company",
           "Officer Name": "John Doe",
           "Email": "john.doe@example.com",
           "Row State": "Unchanged"
       }
   ]
}
Description: Retrieves data from a specific SoftPro lookup table.
userType must match the name of a lookup table in SoftPro (e.g., "Escrow Company", "Lender", "Title Officer").
For "Title Officer" and "Escrow Officer" tables, the API automatically resolves the Officer Name and Email from the SoftPro Security Manager based on the user's lookup code.
The response is returned as a list of objects representing the rows in the lookup table
