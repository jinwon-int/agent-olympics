#!/usr/bin/env node
/**
 * Negative fixture transport: produces no artifacts and never exits.
 *
 * The live runner must kill it at the enforced time limit and — because no
 * usable result packet exists — map the run to `failed`
 * ("timed out without usable output").
 */

'use strict';

setInterval(() => {}, 1000);
