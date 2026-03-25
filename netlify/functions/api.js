// /netlify/functions/api.js

exports.handler = async (event) => {
    // These environmental variables will be set securely in the Netlify Dashboard
    const API_KEY = process.env.AIRTABLE_PAT; 
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    
    const body = JSON.parse(event.body);
    const headers = { 
        "Authorization": `Bearer ${API_KEY}`, 
        "Content-Type": "application/json" 
    };

    try {
        // ACTION 1: VERIFY CODE & FETCH OPTIONS
        if (body.action === 'verify') {
            const code = body.code;
            
            // 1. Find the User Record
            const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/Redemptions?filterByFormula=AND({Redemption Code}='${code}', {Status}='Available')`;
            const userRes = await fetch(searchUrl, { headers });
            const userData = await userRes.json();
            
            if (!userData.records || userData.records.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ error: "Code not found or already claimed." }) };
            }
            
            const userRecord = userData.records[0];
            const zone = userRecord.fields['Zone'];
            
            // 2. Fetch Active Gift Boxes
            const boxesUrl = `https://api.airtable.com/v0/${BASE_ID}/Gift%20Boxes?filterByFormula={Is Active}=1`;
            const boxesRes = await fetch(boxesUrl, { headers });
            const boxesData = await boxesRes.json();

            // 3. Fetch Delivery Slots (Only if eligible)
            let slots = [];
            if (userRecord.fields['Fulfillment Eligibility'] === 'Local Delivery') {
                const slotsUrl = `https://api.airtable.com/v0/${BASE_ID}/Delivery%20Slots?filterByFormula=AND({Zone}='${zone}', {Slot Status}='Available')`;
                const slotsRes = await fetch(slotsUrl, { headers });
                const slotsData = await slotsRes.json();
                slots = slotsData.records || [];
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    user: userRecord,
                    boxes: boxesData.records,
                    slots: slots
                })
            };
        }

        // ACTION 2: SUBMIT ORDER & UPDATE AIRTABLE
        if (body.action === 'submit') {
            const { recordId, boxId, slotId } = body;
            
            const updateFields = {
                "Status": "Claimed",
                "Gift Box": [boxId],
                "Claimed At": new Date().toISOString()
            };
            if (slotId) updateFields["Delivery Slot"] = [slotId];

            const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/Redemptions/${recordId}`;
            const updateRes = await fetch(updateUrl, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ fields: updateFields })
            });

            if (!updateRes.ok) throw new Error("Failed to update Airtable.");

            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};