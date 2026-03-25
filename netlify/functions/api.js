// /netlify/functions/api.js

exports.handler = async (event) => {
    const API_KEY = process.env.AIRTABLE_PAT; 
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    
    const body = JSON.parse(event.body);
    const headers = { 
        "Authorization": `Bearer ${API_KEY}`, 
        "Content-Type": "application/json" 
    };

    try {
        if (body.action === 'verify') {
            const code = body.code;
            
            // 1. Find User
            const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/Redemptions?filterByFormula=AND({Redemption Code}='${code}', {Status}='Available')`;
            const userRes = await fetch(searchUrl, { headers });
            const userData = await userRes.json();
            
            if (!userData.records || userData.records.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ error: "Code not found or already claimed." }) };
            }
            
            const userRecord = userData.records[0];
            
            // Helper to handle Airtable Lookups
            const getFieldValue = (record, fieldName) => {
                const val = record.fields[fieldName];
                return Array.isArray(val) ? val[0] : val;
            };

            const fulfillment = getFieldValue(userRecord, 'Fulfillment Eligibility');
            const zone = getFieldValue(userRecord, 'Zone');
            
            // 2. Fetch Active Gift Boxes (Fixed Checkbox Logic)
            const boxesUrl = `https://api.airtable.com/v0/${BASE_ID}/Gift%20Boxes?filterByFormula={Is Active}`;
            const boxesRes = await fetch(boxesUrl, { headers });
            const boxesData = await boxesRes.json();

            // 3. Fetch Delivery Slots (Fixed Emoji Logic)
            let slots = [];
            if (fulfillment === 'Local Delivery') {
                // Using FIND() to search for the word 'Available' so the 🟢 emoji doesn't break the filter
                const slotsUrl = `https://api.airtable.com/v0/${BASE_ID}/Delivery%20Slots?filterByFormula=AND({Zone}='${zone}', FIND('Available', {Slot Status}) > 0)`;
                const slotsRes = await fetch(slotsUrl, { headers });
                const slotsData = await slotsRes.json();
                slots = slotsData.records || [];
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    user: userRecord,
                    boxes: boxesData.records || [],
                    slots: slots
                })
            };
        }

        // ACTION 2: SUBMIT ORDER & UPDATE AIRTABLE
        if (body.action === 'submit') {
            const { recordId, boxId, slotId } = body;
            
            // We only send the fields Airtable allows us to edit!
            const updateFields = {
                "Status": "Claimed",
                "Gift Box": [boxId]
            };
            
            // Add the delivery slot if one was selected
            if (slotId) {
                updateFields["Delivery Slot"] = [slotId];
            }

            const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/Redemptions/${recordId}`;
            const updateRes = await fetch(updateUrl, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ 
                    fields: updateFields,
                    typecast: true 
                })
            });

            if (!updateRes.ok) {
                const errData = await updateRes.json();
                throw new Error("Airtable says: " + (errData.error.message || "Unknown data formatting error."));
            }

            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
