const FeishuToMarkdown = require('../src/feishu-to-markdown');

require('dotenv').config();

(async () => {
    const f2m = new FeishuToMarkdown({
        sourceType: 'wiki',
        rootToken: "KSvxw0h8LiXtIdkpAnCcrl7cnio",
        baseToken: "LkxfbrY6sa5jQ4sHquEcMqOsnCe",
    });

    const docs = await f2m.list_documents();
    console.log(docs);

    const doc = await f2m.describe_document({ id: "recu1vL7rq1jvb" });
    console.log(doc);

    const md = await f2m.get_markdown({ id: "recu1vL7rq1jvb" });
    console.log(md);
})();