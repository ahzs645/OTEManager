// Self-contained: Chrome serializes this function into an isolated active-tab script.
export async function executeBankAction(
  action,
  payment,
  message,
  securityPreset = null,
  defaultSourceAccount = null,
  recordedReceipt = null,
) {
  try {
    if (
      location.origin !== "https://my.vancity.com" ||
      !location.pathname.startsWith("/banking/")
    )
      throw new Error(
        "Open the Vancity banking tab and click the helper there.",
      );
    if (
      ![
        "navigate",
        "search",
        "open-contact",
        "add-contact",
        "fill-contact",
        "fill-payment",
        "prepare",
        "open-review",
        "ensure-contact",
        "list-accounts",
        "current-account",
        "leave-recorded-receipt",
      ].includes(action)
    )
      throw new Error("Unsupported helper action.");
    const visible = (el) =>
      !!el &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      !el.closest('[hidden],[aria-hidden="true"]');
    const root = () =>
      [...document.querySelectorAll('main,[role="main"]')].find(visible);
    const headings = () =>
      [
        ...(root()?.querySelectorAll('h1,[role="heading"][aria-level="1"]') ||
          []),
      ]
        .filter(visible)
        .map((el) => el.textContent.trim());
    const hasTitle = (title) => headings().includes(title);
    const byId = (id) => root()?.querySelector(`[id="${id}"]`);
    const controls = (scope, name) =>
      [...(scope?.querySelectorAll('button,[role="button"]') || [])].filter(
        (el) => {
          const label = (
            el.getAttribute("aria-label") || el.textContent
          ).trim();
          return (
            visible(el) &&
            !el.disabled &&
            el.getAttribute("aria-disabled") !== "true" &&
            (label.toLowerCase() === name.toLowerCase() ||
              (name === "Send money" && /^Send money \d+ of \d+$/.test(label)))
          );
        },
      );
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, error) => {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const result = predicate();
        if (result) return result;
        await pause(100);
      }
      throw new Error(error);
    };
    const field = (id) => {
      const el = byId(id);
      if (!visible(el) || el.disabled || el.readOnly)
        throw new Error(
          "The expected editable field is unavailable. Open the correct Vancity form.",
        );
      return el;
    };
    const checkLength = (el, value) => {
      if (el.maxLength >= 0 && value.length > el.maxLength)
        throw new Error(
          `A value exceeds Vancity's ${el.maxLength}-character field limit. Enter a shorter value yourself.`,
        );
    };
    const set = (el, value) => {
      checkLength(el, value);
      const prototype =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      if (el.value !== value)
        throw new Error(
          "Vancity did not retain the filled value. Enter it manually.",
        );
    };
    const searchField = () =>
      root()?.querySelector(
        'input[aria-label="Search by name, email or mobile number."]',
      );
    const onContactList = () =>
      hasTitle("Send money") && visible(searchField());
    const hasDraft = () => {
      const amount = byId("RetailEtransfer_paymentAmount_input");
      const note = byId("RetailEtransfer_remarks_input");
      const name = byId("RetailEtransfercontactlogForm_firstName_input");
      const address = byId("RetailEtransfercontactlogForm_emailId_input");
      return (
        (visible(amount) &&
          amount.value.trim() &&
          Number(amount.value.replace(/[$,\s]/g, "")) !== 0) ||
        (visible(note) && note.value.trim()) ||
        (visible(name) && name.value.trim()) ||
        (visible(address) && address.value.trim())
      );
    };
    const ensureContacts = async (savedContact = false) => {
      if (onContactList()) return;
      if (hasDraft() && !savedContact)
        throw new Error(
          "Vancity has an unfinished contact or payment form. Review or clear it before navigating to another recipient.",
        );
      const nav = [...document.querySelectorAll('[role="menuitem"]')].filter(
        (el) =>
          visible(el) &&
          (el.getAttribute("aria-label") || el.textContent).trim() ===
            "e-Transfers",
      );
      if (nav.length !== 1)
        throw new Error(
          "Sign in to Vancity first. The e-Transfers navigation is unavailable.",
        );
      nav[0].click();
      await waitFor(
        () => onContactList() || controls(root(), "Send money")[0],
        "Vancity did not open e-Transfers. Check for a sign-in prompt or bank message.",
      );
      if (!onContactList()) controls(root(), "Send money")[0].click();
      await waitFor(
        onContactList,
        "Vancity did not open the Send money contact list. Check the bank page and try again.",
      );
    };
    const accountPicker = () =>
      [
        ...document.querySelectorAll('mat-dialog-container[role="dialog"]'),
      ].find(
        (dialog) =>
          visible(dialog) &&
          visible(dialog.querySelector("app-casa-accounts-list")) &&
          [
            ...dialog.querySelectorAll('h1,[role="heading"][aria-level="1"]'),
          ].some(
            (el) =>
              visible(el) && el.textContent.trim() === "Select an account",
          ),
      );
    const sourceAccountButton = () => {
      const candidates = [
        ...(root()?.querySelectorAll('button,[role="button"]') || []),
      ].filter(
        (el) =>
          visible(el) &&
          (el.getAttribute("aria-label") || "").startsWith(
            "Select source account ",
          ),
      );
      if (candidates.length !== 1 || !hasTitle("Send money"))
        throw new Error(
          "Open a Vancity Send money form to read its source accounts.",
        );
      return candidates[0];
    };
    const selectedSourceAccount = () => {
      const button = sourceAccountButton();
      const label = button.getAttribute("aria-label") || "";
      const number = label.match(/\bAccount\s+(\d{8,20})\b/i)?.[1];
      const name = button
        .querySelector(".account-header h2")
        ?.textContent.trim();
      const type = button
        .querySelector(".account-header p")
        ?.textContent.replace(number || "", "")
        .replace(/\s+/g, " ")
        .trim();
      if (!number || !name || !type)
        throw new Error(
          "Vancity's selected source account could not be read. Choose it in the bank first.",
        );
      return { accountNumber: number, name, type };
    };
    const accountOptions = (dialog) =>
      [...dialog.querySelectorAll('.summary-card-inner[role="row"]')]
        .filter(visible)
        .map((row) => {
          const label = row.getAttribute("aria-label") || "";
          const match = label.match(
            /^(.*),\s*([^,]+),\s*Account number\s+(\d{8,20})\b/,
          );
          if (!match)
            throw new Error(
              "Vancity's account choices could not be identified. Choose the account yourself.",
            );
          return {
            row,
            account: {
              accountNumber: match[3],
              name: match[1].trim(),
              type: match[2].trim(),
            },
            availableBalance:
              label.match(/Available Balance:\s*CAD\s*([-\d,.]+)\s*\$/)?.[1] ||
              "",
          };
        });
    const openAccountPicker = async () => {
      const open = accountPicker();
      if (open) return open;
      sourceAccountButton().click();
      return await waitFor(
        accountPicker,
        "Vancity did not open its source-account choices. Choose the account yourself.",
      );
    };
    const closeAccountPicker = async (dialog) => {
      const cancel = controls(dialog, "Cancel");
      if (cancel.length !== 1)
        throw new Error("Close Vancity's account picker before trying again.");
      cancel[0].click();
      await waitFor(
        () => !visible(dialog),
        "Vancity did not close its account picker.",
      );
    };
    if (action === "current-account")
      return {
        status: "account",
        account: selectedSourceAccount(),
        message: "Read the selected Vancity account.",
      };
    if (action === "list-accounts") {
      const alreadyOpen = !!accountPicker();
      const dialog = await openAccountPicker();
      try {
        const options = await waitFor(() => {
          const accounts = accountOptions(dialog);
          return accounts.length && accounts;
        }, "Vancity has not loaded its account choices.");
        return {
          status: "accounts",
          accounts: options.map(({ account, availableBalance }) => ({
            ...account,
            availableBalance,
          })),
          message: "Read the available source accounts from Vancity.",
        };
      } finally {
        if (!alreadyOpen && visible(dialog)) await closeAccountPicker(dialog);
      }
    }
    const selectSourceAccount = async () => {
      if (!defaultSourceAccount) return null;
      if (
        typeof defaultSourceAccount.accountNumber !== "string" ||
        !/^\d{8,20}$/.test(defaultSourceAccount.accountNumber)
      )
        throw new Error(
          "The saved source account is invalid. Read and save it again in the helper.",
        );
      const current = selectedSourceAccount();
      if (current.accountNumber === defaultSourceAccount.accountNumber)
        return current;
      const dialog = await openAccountPicker();
      const options = await waitFor(() => {
        const accounts = accountOptions(dialog);
        return accounts.length && accounts;
      }, "Vancity has not loaded the source-account choices. Choose the account yourself.");
      const matches = options.filter(
        ({ account }) =>
          account.accountNumber === defaultSourceAccount.accountNumber,
      );
      if (matches.length !== 1) {
        await closeAccountPicker(dialog);
        throw new Error(
          "The saved source account is not a unique available choice in Vancity. Read the accounts again or choose it yourself.",
        );
      }
      matches[0].row.click();
      const confirm = await waitFor(() => {
        const label = matches[0].row.getAttribute("aria-label") || "";
        const buttons = controls(dialog, "Confirm selection");
        return (
          visible(dialog) &&
          /,\s*Selected,/.test(label) &&
          buttons.length === 1 &&
          buttons[0]
        );
      }, "Vancity did not select the saved source account. Review its account picker.");
      confirm.click();
      await waitFor(() => {
        if (
          visible(dialog) ||
          !visible(byId("RetailEtransfer_paymentAmount_input"))
        )
          return false;
        try {
          return (
            selectedSourceAccount().accountNumber ===
            defaultSourceAccount.accountNumber
          );
        } catch {
          return false;
        }
      }, "Vancity did not apply the saved source account. Check its selected account before preparing again.");
      return selectedSourceAccount();
    };
    if (action === "leave-recorded-receipt") {
      if (!recordedReceipt || !/^\d{20}$/.test(recordedReceipt.reference))
        throw new Error(
          "A recorded bank receipt is required before preparing the next payment.",
        );
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
        visible,
      );
      if (dialogs.length) {
        const matches = dialogs.filter((dialog) => {
          const success = dialog.querySelector(".ETRANSFERSENDMONEY.success");
          if (
            !visible(success) ||
            (
              success
                .querySelector(".confirmation-description-text")
                ?.getAttribute("aria-label") ||
              success.querySelector(".confirmation-description-text")
                ?.textContent
            )?.trim() !== "Your transfer has been sent."
          )
            return false;
          const rows = new Map(
            [...success.querySelectorAll("app-display-label-value-control")]
              .filter(visible)
              .map((row) => [
                (
                  row.querySelector("mat-label")?.getAttribute("aria-label") ||
                  row.querySelector("mat-label")?.textContent ||
                  ""
                ).trim(),
                row
                  .querySelector("fpx-display-text")
                  ?.textContent?.replace(/\s+/g, " ")
                  .trim(),
              ]),
          );
          return (
            rows.get("Reference #") === recordedReceipt.reference &&
            rows.get("Email address")?.toLowerCase() ===
              recordedReceipt.recipientEmail &&
            rows.get("Message") ===
              recordedReceipt.message.replace(/\s+/g, " ").trim()
          );
        });
        if (matches.length !== 1 || dialogs.length !== 1)
          throw new Error(
            "The visible bank dialog is not the payment just recorded. Close it yourself before continuing.",
          );
        const back = controls(matches[0], "Back to e-Transfers");
        if (back.length !== 1)
          throw new Error(
            "Cannot leave the recorded bank receipt. Use Back to e-Transfers yourself.",
          );
        back[0].click();
        await waitFor(
          () => !visible(matches[0]),
          "Vancity did not close the recorded receipt.",
        );
      } else if (
        visible(byId("RetailEtransfer_paymentAmount_input")) ||
        visible(byId("RetailEtransfercontactlogForm_firstName_input")) ||
        hasTitle("Add contact") ||
        (hasTitle("Send money") && !onContactList())
      ) {
        throw new Error(
          "A bank form is already open. Review it before preparing another payment.",
        );
      }
      await ensureContacts(true);
      return {
        status: "navigated",
        message: "Returned from the recorded payment to e-transfer contacts.",
      };
    }
    if (action === "navigate") {
      await ensureContacts();
      return {
        status: "navigated",
        message:
          "Opened e-Transfers → Send money. Choose a payment and click Prepare this payment.",
      };
    }
    if (
      !payment ||
      typeof payment.recipientEmail !== "string" ||
      typeof payment.recipientName !== "string"
    )
      throw new Error("Import a payment export first.");
    const email = payment.recipientEmail.trim().toLowerCase();
    let contactName = payment.recipientName;
    let contactNumber = 1;
    const numberedContactName = (number) => {
      const suffix = ` ${number}`;
      return (
        payment.recipientName.slice(0, 35 - suffix.length).trimEnd() + suffix
      );
    };
    const adoptContactName = (value) => {
      if (value === payment.recipientName) {
        contactName = value;
        contactNumber = 1;
        return true;
      }
      for (let number = 2; number <= 100; number++)
        if (value === numberedContactName(number)) {
          contactName = value;
          contactNumber = number;
          return true;
        }
      return false;
    };
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 64 ||
      !Number.isSafeInteger(payment.amountCents) ||
      payment.amountCents <= 0
    )
      throw new Error("Invalid recipient email or payment amount.");
    const contactRows = () =>
      [
        ...(root()?.querySelectorAll('.contact-virtual-row[role="button"]') ||
          []),
      ].filter(visible);
    const rowEmails = (row) =>
      [...row.querySelectorAll("span.accountNumber")].map((el) =>
        el.textContent.trim().toLowerCase(),
      );
    const search = async () => {
      if (!(
        visible(searchField()) &&
        ["Manage contacts", "Send money"].some(hasTitle)
      ))
        await ensureContacts();
      const input = searchField();
      set(input, email);
      await pause(1200);
      if (input.value.trim().toLowerCase() !== email || !visible(input))
        throw new Error("The bank page changed while searching. Search again.");
      const rows = contactRows();
      const matches = rows.filter((row) => rowEmails(row).includes(email));
      if (
        rows.some(
          (row) => !rowEmails(row).some((address) => address.includes(email)),
        )
      )
        throw new Error(
          "Contact search is still showing unrelated results. Wait and search again.",
        );
      if (!matches.length) {
        const empty = byId("no-result-title");
        if (
          rows.length ||
          !visible(empty) ||
          empty.textContent.trim() !== "Contact not found"
        )
          throw new Error(
            "Vancity has not confirmed an empty contact search. Review the results or search again.",
          );
      }
      return matches;
    };
    const openMatching = async (matches) => {
      if (!hasTitle("Send money")) {
        await ensureContacts();
        matches = await search();
      }
      if (matches.length !== 1)
        throw new Error(
          "Only one exact email match can be selected. Choose ambiguous contacts yourself.",
        );
      matches[0].click();
      await waitFor(
        () => visible(byId("RetailEtransfer_contactEmailId_input")),
        "The recipient's Send money form did not open.",
      );
      if (
        byId("RetailEtransfer_contactEmailId_input")
          .value.trim()
          .toLowerCase() !== email
      )
        throw new Error(
          "The opened recipient email does not match this payment.",
        );
    };
    const openNew = async (matches) => {
      if (matches.length)
        throw new Error(
          "An exact email match already exists. Use the existing contact.",
        );
      const candidates = controls(root(), "Add contact");
      const primary = candidates.filter((el) => !el.closest('[role="status"]'));
      const add =
        primary.length === 1
          ? primary[0]
          : candidates.length === 1
            ? candidates[0]
            : null;
      if (!add) throw new Error("Cannot locate Add contact. Open it yourself.");
      add.click();
      await waitFor(
        () => visible(byId("RetailEtransfercontactlogForm_firstName_input")),
        "Vancity did not open Add contact.",
      );
    };
    const securityFields = (prefix) => {
      const question = byId(`${prefix}_securityQuestion_input`);
      const answer = byId(`${prefix}_securityAnswer_input`);
      const confirm = byId(`${prefix}_confirmSecurityAnswer_input`);
      if (!visible(question) && !visible(answer)) return [];
      if (
        !visible(question) ||
        !visible(answer) ||
        question.disabled ||
        answer.disabled ||
        question.readOnly ||
        answer.readOnly
      )
        throw new Error(
          "Review the security question fields in Vancity; they are not ready to fill.",
        );
      if (!securityPreset) {
        if (
          question.value.trim() &&
          answer.value.trim() &&
          (!visible(confirm) || confirm.value === answer.value)
        )
          return [];
        return null;
      }
      if (
        typeof securityPreset.question !== "string" ||
        !securityPreset.question.trim() ||
        typeof securityPreset.answer !== "string" ||
        !securityPreset.answer.trim()
      )
        throw new Error(
          "Save a valid question and answer in the helper first.",
        );
      const values = [
        [question, securityPreset.question],
        [answer, securityPreset.answer],
      ];
      if (visible(confirm)) values.push([confirm, securityPreset.answer]);
      // Existing contacts can prefill a prior question while deliberately
      // leaving the answer blank. The saved preset prepares the whole pair.
      const unanswered =
        !answer.value.trim() && (!visible(confirm) || !confirm.value.trim());
      for (const [el, value] of values) {
        if (el.disabled || el.readOnly)
          throw new Error("The security fields cannot be edited yet.");
        checkLength(el, value);
        if (
          el.value.trim() &&
          el.value !== value &&
          !(el === question && unanswered)
        )
          throw new Error(
            "The bank form has a different security question or answer. Review or clear it yourself.",
          );
      }
      return values;
    };
    const fillContact = async () => {
      if (!visible(byId("RetailEtransfercontactlogForm_firstName_input")))
        await openNew(await search());
      const name = field("RetailEtransfercontactlogForm_firstName_input");
      const address = field("RetailEtransfercontactlogForm_emailId_input");
      if (
        !byId(
          "RetailEtransfercontactlogForm_notificationPreference_input_E-input",
        )?.checked
      )
        throw new Error(
          "Select Email as the notification method in Vancity first.",
        );
      checkLength(name, payment.recipientName);
      checkLength(address, email);
      if (
        (name.value.trim() && !adoptContactName(name.value.trim())) ||
        (address.value.trim() && address.value.trim().toLowerCase() !== email)
      )
        throw new Error(
          "The contact form already contains different details. Review or clear it yourself.",
        );
      set(name, contactName);
      set(address, email);
      await pause(800);
      const secure = securityFields("RetailEtransfercontactlogForm");
      for (const [el, value] of secure || []) set(el, value);
      return {
        status: "contact-filled",
        needsSecurityPreset: secure === null,
        message:
          "This email was not in contacts. Filled the new contact details" +
          (secure?.length
            ? " and your saved question and answer"
            : secure === null
              ? "; save the question and answer in the helper or enter them yourself"
              : "") +
          ". Review and save the contact in Vancity, then click Prepare this payment again.",
      };
    };
    const paymentFields = () => {
      const recipient = byId("RetailEtransfer_contactEmailId_input");
      if (!visible(recipient) || recipient.value.trim().toLowerCase() !== email)
        throw new Error(
          "The recipient email in Vancity does not match this payment. Select the correct contact yourself.",
        );
      if (
        !byId("RetailEtransfer_notificationPreference_input_E-input")?.checked
      )
        throw new Error("Select Email as the notification method first.");
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 400
      )
        throw new Error("Enter a payment message of 1–400 characters.");
      const amountField = field("RetailEtransfer_paymentAmount_input");
      const messageField = field("RetailEtransfer_remarks_input");
      const amount = `${Math.floor(payment.amountCents / 100)}.${String(payment.amountCents % 100).padStart(2, "0")}`;
      const existing = amountField.value.replace(/[$,\s]/g, "");
      if (
        existing &&
        Number(existing) !== 0 &&
        Number(existing) !== Number(amount)
      )
        throw new Error(
          "The bank form already has a different amount. Review or clear it yourself.",
        );
      if (messageField.value.trim() && messageField.value !== message)
        throw new Error(
          "The bank form already has a different message. Review or clear it yourself.",
        );
      checkLength(amountField, amount);
      checkLength(messageField, message);
      const secure = securityFields("RetailEtransfer");
      if (secure === null)
        throw new Error(
          "This recipient needs a security question and answer. Save them in the helper settings or fill them in Vancity first.",
        );
      return { amountField, messageField, amount, secure };
    };
    const settlePaymentFields = async (
      changedMessage = "Vancity changed the payment fields after filling. Prepare the payment again.",
    ) => {
      let stableSince = null;
      let stableFields = [];
      let settled;
      await waitFor(() => {
        let current;
        try {
          current = paymentFields();
        } catch (error) {
          if (
            [
              "Review the security question fields in Vancity; they are not ready to fill.",
              "The security fields cannot be edited yet.",
            ].includes(error.message)
          ) {
            stableSince = null;
            return false;
          }
          throw error;
        }
        if (
          Number(current.amountField.value.replace(/[$,\s]/g, "")) !==
            payment.amountCents / 100 ||
          current.messageField.value !== message
        )
          throw new Error(changedMessage);
        // Changing the question can replace the answer widget. Write one field
        // per pass and reacquire the live widgets before writing the next one.
        const missing = current.secure.find(
          ([el, value]) => el.value !== value,
        );
        if (missing) {
          set(missing[0], missing[1]);
          stableSince = null;
          return false;
        }
        if (controls(root(), "Continue").length !== 1) {
          stableSince = null;
          return false;
        }
        const fields = [
          current.amountField,
          current.messageField,
          ...current.secure.map(([el]) => el),
        ];
        if (
          stableSince === null ||
          fields.length !== stableFields.length ||
          fields.some((el, i) => el !== stableFields[i])
        ) {
          stableSince = Date.now();
          stableFields = fields;
        }
        settled = current;
        return Date.now() - stableSince >= 800;
      }, "Vancity did not retain a complete payment form with enabled Continue. Check its validation messages; nothing was sent.");
      return settled;
    };
    const fillPayment = async () => {
      // Account changes can recreate/reset the bank fields. Validate before
      // changing accounts, then reacquire the fields and fill them afterwards.
      paymentFields();
      const sourceAccount = await selectSourceAccount();
      const { amountField, messageField, amount } = paymentFields();
      set(amountField, amount);
      set(messageField, message);
      // Amount/account updates can rebuild the security widgets asynchronously.
      // Fill only the current widgets after that update has settled.
      await pause(1200);
      const { secure } = await settlePaymentFields();
      return {
        status: "filled",
        message:
          "Prepared the matching recipient's payment amount and article message" +
          (secure.length ? " with your saved question and answer" : "") +
          (sourceAccount
            ? ` using ${sourceAccount.name} (ending ${sourceAccount.accountNumber.slice(-4)})`
            : "") +
          ". Review the source account, recipient and date, then Continue and Send yourself in Vancity.",
      };
    };
    const openPaymentReview = async () => {
      const clean = (s) => s.replace(/\s+/g, " ").trim();
      const reviewShown = () =>
        hasTitle("Send money") &&
        [...(root()?.querySelectorAll("*") || [])].some(
          (el) =>
            visible(el) &&
            !el.children.length &&
            clean(el.textContent) === "Review",
        ) &&
        // Vancity retains editable form widgets behind its Review display.
        // The final Confirm control identifies the review stage; inspect it
        // without ever clicking it or requiring cached inputs to disappear.
        [...(root()?.querySelectorAll('button,[role="button"]') || [])].filter(
          (el) =>
            visible(el) &&
            (el.getAttribute("aria-label") || el.textContent).trim() ===
              "Confirm",
        ).length === 1;
      const reviewMatches = () => {
        if (!reviewShown()) return false;
        const shown = (id, expected, ignoreCase = false) => {
          const equal = (actual) => {
            if (id === "RetailEtransfer_paymentAmount_input") {
              const number = clean(actual).match(
                /^(?:CAD\s*)?\$?\s*([\d,]+\.\d{2})$/,
              );
              return (
                !!number &&
                Number(number[1].replaceAll(",", "")) ===
                  payment.amountCents / 100
              );
            }
            return ignoreCase
              ? clean(actual).toLowerCase() === clean(expected).toLowerCase()
              : clean(actual) === clean(expected);
          };
          if (id === "RetailEtransfer_paymentAmount_input") {
            // Review renders the currency symbol in a nested <em>. Read the
            // Amount value as a whole, bound to its label, rather than looking
            // for a matching text leaf, cached input, fee or account balance.
            const rows = [
              ...(root()?.querySelectorAll('.display-field[role="group"]') ||
                []),
            ].filter(
              (row) =>
                visible(row) &&
                clean(row.querySelector(".label")?.textContent || "") ===
                  "Amount",
            );
            const values =
              rows.length === 1
                ? [...rows[0].querySelectorAll(".value")].filter(visible)
                : [];
            return (
              values.length === 1 &&
              !values[0].querySelector("input,textarea,select,script,style") &&
              equal(values[0].textContent)
            );
          }
          const el = byId(id);
          const displayed = [
            ...(el?.parentElement?.querySelectorAll(".fpx-readonly-text") ||
              []),
          ].filter(visible);
          if (displayed.length)
            return displayed.length === 1 && equal(displayed[0].textContent);
          return (
            (visible(el) &&
              (el.readOnly || el.disabled) &&
              typeof el.value === "string" &&
              equal(el.value)) ||
            [...(root()?.querySelectorAll("*") || [])].some(
              (el) =>
                visible(el) &&
                !el.children.length &&
                !el.closest("input,textarea,select,script,style") &&
                equal(el.textContent),
            )
          );
        };
        const amount = (payment.amountCents / 100).toFixed(2);
        return (
          shown("RetailEtransfer_contactEmailId_input", email, true) &&
          shown("RetailEtransfer_paymentAmount_input", amount) &&
          shown("RetailEtransfer_remarks_input", message)
        );
      };
      if (!reviewShown()) {
        if (!hasTitle("Send money"))
          throw new Error(
            "Open the prepared Send money form before opening Review.",
          );
        const current = await settlePaymentFields(
          "The payment form is not fully prepared. Prepare it again before opening Review.",
        );
        if (
          Number(current.amountField.value.replace(/[$,\s]/g, "")) !==
            payment.amountCents / 100 ||
          current.messageField.value !== message ||
          current.secure.some(([el, value]) => el.value !== value)
        )
          throw new Error(
            "The payment form is not fully prepared. Prepare it again before opening Review.",
          );
        if (
          defaultSourceAccount &&
          selectedSourceAccount().accountNumber !==
            defaultSourceAccount.accountNumber
        )
          throw new Error(
            "The source account changed. Prepare the payment again before opening Review.",
          );
        const next = controls(root(), "Continue");
        if (next.length !== 1)
          throw new Error(
            "Vancity has not enabled payment Continue. Review its validation messages.",
          );
        next[0].click();
        await waitFor(
          reviewShown,
          "Vancity did not open payment Review. Check the bank page; nothing was sent.",
        );
      }
      await waitFor(
        reviewMatches,
        "The bank Review does not match the prepared email, amount, and article message. Check Vancity before sending.",
      );
      return {
        status: "reviewed",
        message:
          "Opened the matching payment Review. Check the account, recipient, amount, date, and message, then use Vancity's final Send or Confirm yourself.",
      };
    };
    if (action === "open-review") return await openPaymentReview();
    const syntheticRecipient = () => {
      const domain = email.split("@")[1];
      return (
        /\.(test|invalid|localhost|example)$/.test(domain) ||
        ["example.com", "example.net", "example.org"].some(
          (d) => domain === d || domain.endsWith(`.${d}`),
        )
      );
    };
    const identityShown = (requireEmail = true) => {
      const shownValue = (id, expected) => {
        const el = byId(id);
        return (
          visible(el) &&
          el.value?.trim().toLowerCase() === expected.toLowerCase()
        );
      };
      const shownText = (expected) =>
        [...(root()?.querySelectorAll("*") || [])].some(
          (el) =>
            visible(el) &&
            el.children.length === 0 &&
            el.textContent.trim().toLowerCase() === expected.toLowerCase(),
        );
      return (
        (!requireEmail ||
          shownValue("RetailEtransfercontactlogForm_emailId_input", email) ||
          shownText(email)) &&
        (shownValue(
          "RetailEtransfercontactlogForm_firstName_input",
          contactName,
        ) ||
          shownText(contactName))
      );
    };
    const contactSaveConfirmed = () => {
      if (contactSuccessDialog()) return true;
      if (
        onContactList() ||
        (hasTitle("Manage contacts") && visible(searchField()))
      )
        return true;
      return [...(root()?.querySelectorAll("*") || [])].some(
        (el) =>
          visible(el) &&
          el.children.length === 0 &&
          /\bcontact\s+(?:has\s+been\s+)?(?:successfully\s+)?(?:added|saved|created)\b|\bsuccessfully\s+(?:added|saved|created)\s+(?:the\s+)?contact\b/i.test(
            el.textContent,
          ),
      );
    };
    const contactSuccessDialog = () =>
      [
        ...document.querySelectorAll('mat-dialog-container[role="dialog"]'),
      ].find(
        (dialog) =>
          visible(dialog) &&
          visible(
            dialog.querySelector("app-etransfer-confirmation-receipt-form"),
          ) &&
          [...dialog.querySelectorAll('[role="status"]')].some(
            (el) =>
              visible(el) &&
              el.textContent.trim() === "Success! New contact has been added.",
          ),
      );
    const leaveContactSuccessDialog = async () => {
      const dialog = contactSuccessDialog();
      if (!dialog) return;
      const back = controls(dialog, "Back to e-Transfers");
      if (back.length !== 1)
        throw new Error(
          "Vancity confirmed contact creation. Close its success popup, then click Prepare again to find the saved contact.",
        );
      back[0].click();
      await waitFor(
        () =>
          !visible(dialog) &&
          (onContactList() || controls(root(), "Send money").length === 1),
        "The contact was saved, but Vancity did not leave its success popup. Open Send money and Prepare again.",
      );
    };
    const contactSaveButton = () => {
      const buttons = controls(root(), "Add contact");
      if (buttons.length === 1) return buttons[0];
      const confirm = byId("fpx-submit-shell-btn");
      return visible(confirm) &&
        !confirm.disabled &&
        (confirm.getAttribute("aria-label") || confirm.textContent).trim() ===
          "Confirm"
        ? confirm
        : null;
    };
    const saveContactAndPrepare = async (filled = null) => {
      if (syntheticRecipient())
        return {
          status: "contact-filled",
          message:
            "Synthetic recipient: filled for preview only. The helper will not save example or test addresses. Use a real Payment Manager export to create contacts and prepare their payments.",
        };
      if (filled?.needsSecurityPreset)
        throw new Error(
          "Save the question and answer in the helper or complete them in Vancity before saving this contact.",
        );
      if (!hasTitle("Add contact") || !identityShown())
        throw new Error(
          "The contact name/email in Vancity does not match this payment. Nothing was saved.",
        );
      const contactRoute = location.pathname + location.search;
      let continuedFromVerifiedForm = false;
      const input = byId("RetailEtransfercontactlogForm_firstName_input");
      if (visible(input) && !input.readOnly && !input.disabled) {
        const duplicateName = () =>
          [
            ...(
              input.closest("fpx-text-box") || input.parentElement
            ).querySelectorAll('[role="alert"]'),
          ].some(
            (el) =>
              visible(el) &&
              /^You already have a contact with this name\. Please change the contact name\.$/i.test(
                el.textContent.replace(/\s+/g, " ").trim(),
              ),
          );
        let next;
        while (!next) {
          const outcome = await waitFor(() => {
            if (
              !hasTitle("Add contact") ||
              !identityShown() ||
              input.value !== contactName
            )
              throw new Error(
                "The contact form changed while validating its name. Nothing was saved.",
              );
            if (duplicateName()) return "duplicate";
            return (
              controls(root(), "Continue").length === 1 &&
              controls(root(), "Continue")[0]
            );
          }, "Vancity has not enabled the contact Continue button. Complete its required fields or check its validation message.");
          if (outcome === "duplicate") {
            if (contactNumber >= 100)
              throw new Error(
                "Contact names 2 through 100 are already in use. Choose a distinct name in Vancity.",
              );
            contactName = numberedContactName(++contactNumber);
            set(input, contactName);
            // Let the bank finish the new name's asynchronous validation before
            // interpreting its error or enabled Continue state again.
            await pause(1200);
          } else next = outcome;
        }
        next.click();
        continuedFromVerifiedForm = true;
      }
      const reviewMatches = () => {
        const reviewEmails = [...(root()?.querySelectorAll("*") || [])]
          .filter(
            (el) =>
              visible(el) &&
              el.children.length === 0 &&
              !el.textContent.includes("*"),
          )
          .flatMap(
            (el) =>
              el.textContent.match(
                /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
              ) || [],
          );
        if (reviewEmails.some((address) => address.toLowerCase() !== email))
          return false;
        return (
          hasTitle("Add contact") &&
          location.pathname + location.search === contactRoute &&
          (identityShown() ||
            (continuedFromVerifiedForm &&
              identityShown(false) &&
              visible(
                root()?.querySelector("app-retail-etransfercontactlog-form"),
              )))
        );
      };
      const save = await waitFor(() => {
        if (!reviewMatches()) return false;
        return contactSaveButton();
      }, "The Add contact review was not recognised. Review and save this contact in Vancity, then Prepare again.");
      if (!reviewMatches())
        throw new Error("Contact review changed. Nothing was saved.");
      save.click();
      await waitFor(
        contactSaveConfirmed,
        "Contact save was submitted, but the bank has not confirmed it. Check Vancity's result before retrying; the contact may already be saved.",
      );
      await leaveContactSuccessDialog();
      await ensureContacts(true);
      const matches = await search();
      if (matches.length !== 1)
        throw new Error(
          "The bank confirmed contact creation, but its email is not a unique match. Select the recipient yourself.",
        );
      if (action === "ensure-contact")
        return {
          status: "created",
          contactCreated: true,
          contactName,
          message: `Created the contact${contactNumber > 1 ? ` as ${contactName}` : ""} and verified its exact email in Vancity.`,
        };
      await openMatching(matches);
      return { ...(await fillPayment()), contactCreated: true, contactName };
    };
    // A prior preparation can stop after the bank saved the contact. Resume by
    // closing only the recognised contact-success receipt and searching again.
    if (
      ["prepare", "ensure-contact"].includes(action) &&
      contactSuccessDialog()
    ) {
      await leaveContactSuccessDialog();
      await ensureContacts(true);
    }
    if (action === "fill-contact") return await fillContact();
    if (
      action === "fill-payment" &&
      visible(byId("RetailEtransfer_contactEmailId_input"))
    )
      return await fillPayment();
    if (
      action === "prepare" &&
      visible(byId("RetailEtransfer_contactEmailId_input")) &&
      byId("RetailEtransfer_contactEmailId_input")
        .value.trim()
        .toLowerCase() === email
    )
      return await fillPayment();
    if (
      ["prepare", "ensure-contact"].includes(action) &&
      visible(byId("RetailEtransfercontactlogForm_emailId_input")) &&
      (!byId("RetailEtransfercontactlogForm_emailId_input").value.trim() ||
        byId("RetailEtransfercontactlogForm_emailId_input")
          .value.trim()
          .toLowerCase() === email)
    )
      return await saveContactAndPrepare(await fillContact());
    if (
      ["prepare", "ensure-contact"].includes(action) &&
      hasTitle("Add contact") &&
      identityShown() &&
      contactSaveButton()
    )
      return await saveContactAndPrepare();
    if (["open-contact", "prepare", "fill-payment"].includes(action))
      await ensureContacts();
    const matches = await search();
    if (action === "ensure-contact") {
      if (matches.length)
        return {
          status: matches.length === 1 ? "matched" : "ambiguous",
          message:
            matches.length === 1
              ? "The exact email already exists. No contact was created."
              : "Multiple exact email matches; choose the contact yourself.",
        };
      await openNew(matches);
      return await saveContactAndPrepare(await fillContact());
    }
    if (action === "search")
      return {
        status:
          matches.length === 1
            ? "matched"
            : matches.length > 1
              ? "ambiguous"
              : "no-match",
        count: matches.length,
        message:
          matches.length === 1
            ? "One contact matches the exact email."
            : matches.length > 1
              ? "Multiple exact email matches; choose the intended contact yourself."
              : "Vancity shows Contact not found for this email.",
      };
    if (action === "add-contact") {
      await openNew(matches);
      return {
        status: "opened",
        message:
          "Opened Add contact. Review and save the contact yourself after filling.",
      };
    }
    if (action === "prepare" && matches.length === 0) {
      await openNew(matches);
      return await saveContactAndPrepare(await fillContact());
    }
    await openMatching(matches);
    if (action === "open-contact")
      return {
        status: "opened",
        message: "Opened the exact matching recipient's Send money form.",
      };
    return await fillPayment();
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "The bank action could not be completed. Review the current page.",
    };
  }
}
