// Prevent Discord Gateway from replaying the same interaction, thereby avoiding duplicate processing.



// Periodically purge old IDs that are more than 10 minutes old (interaction tokens have a 15-minute validity period).




// Step 1: Serial — First retrieve historical data, then allow the Routing Agent to make a decision.



// Step 2: Concurrent — Based on the routing results, select which tables to search, using keywords as the unified input for retrieval across all sources.



// Step 3: Format the context.



// Step 4: Construct the message sequence, passing in the keywords to allow `getResponse` to inject the relevant context paragraphs.



// Deduplication: Ensure that the same interaction is not processed more than once (as the Gateway may replay events upon reconnection).

