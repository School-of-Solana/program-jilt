Configuration: It defines crucial addresses for its operation:
HOOK_PROGRAM_ID: The on-chain address of your custom transfer hook program.
HOOKED_TOKEN_MINT: The mint address of the token that has the transfer hook enabled.
FEE_TOKEN_MINT: The mint address for the token used to pay fees (in this case, Wrapped SOL).
Signer Loading: The loadSigner function automatically loads the default Solana CLI keypair from your computer. This keypair is used to sign and pay for the transactions.
Transaction Handling: The sendAndConfirmTransaction function simplifies the process of building, signing, and sending a transaction to the Solana network.
Supported Commands
The CLI is organized into three main commands that you can run from your terminal:

init

Purpose: To perform a one-time setup for the hook program.
Actions:
It initializes an extra-account-metas Program-Derived Address (PDA). This is a standard requirement for the Token-2022 transfer hook, telling the runtime which additional accounts the hook program needs during a transfer.
It initializes a treasury PDA, which is a custom account used by the hook program to collect and store the fees taken from transfers.
Usage: npx ts-node cli.ts init
transfer

Purpose: To execute a token transfer that will trigger the custom hook logic.
Actions:
It takes a recipient address and an amount as input.
It creates a standard token transfer instruction.
Crucially, it adds the required extra accounts for the hook, which signals the Solana runtime to invoke your custom program's logic (e.g., to deduct a fee) as part of the transfer.
Usage: npx ts-node cli.ts transfer <RECIPIENT_ADDRESS> <AMOUNT>
withdraw

Purpose: Allows the program's authority (the administrator) to withdraw the collected fees from the treasury account.
Actions:
It takes an amount as input.
It constructs an instruction to call the withdraw function in the smart contract, which moves funds from the treasury PDA to an admin-controlled token account.
Usage: npx ts-node cli.ts withdraw <AMOUNT>
