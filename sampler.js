"use strict";


function* range(length) {
    for(let i=0;i<length;i++) yield i;
}

function random_choice(array) {
    return array[Math.floor(array.length * Math.random())];
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// This is the inner-most loop a lot of the time, and needs to be fast.
function get_subword(word, indices) {
    //let subword = "";
    //for(let i of indices)
    //    subword += word[i];
    //return subword;
    
    return indices.map(i => word[i]).join("");
}


function get_random_choice(rand, probs) {
    let i = 0;
    while(true) {
        if (i >= probs.length-1) return i;
        rand -= probs[i];
        if (rand <= 0) return i;
        i++
    }
}




/* Sample a set of words produced by making [n] choices amongst [choices].

   initial is an initial blank slate.
   
   get_advancer returns a function to advance a word by making the ith choice. If the choice is invalid, the function will return null.

   callback is periodically called back with current set of words, if not null.
   
   Returns {words, saturated}:
       words = a set of randomly sampled words
       saturated = the choice at which the pool become full and we started subsampling
 */
function get_samples(initial, n, choices, effort, get_advancer, callback) {
    let last_callback = Date.now();
    let n_choices = choices.length;
    let saturated = null;
    
    // Initial pool of samples contains the initial word
    let words = [ initial ];

    // Try extending each word in the pool by each of the possible choices.
    // If valid extensions don't exceed effort, the new pool is exhaustive.
    // Otherwise a random subset of valid extensions is kept.
    for(let i of range(n)) {
        let todo = Array.from(range(words.length * n_choices));
        shuffle(todo);
        
        let advancer = get_advancer(i);

        let new_words = [ ];
        for(let j of todo) {
            let item = advancer(words[j/n_choices>>0], choices[j % n_choices]);
            if (item === null) continue;
            new_words.push(item);
            if (new_words.length >= effort) break;
        }
        
        if (saturated === null && new_words.length >= effort)
            saturated = i;

        words = new_words;
        
        if (callback !== null && Date.now() > last_callback + 200) {
            callback({words, saturated});
            last_callback = Date.now();
        }
    }

    return {words, saturated};
}


/* Weighted version of get_samples. 
 */
function get_weighted_samples(initial, n, choices, choice_weights, effort, get_advancer, callback) {
    let last_callback = Date.now();
    let n_choices = choices.length;
    let saturated = null;
    
    // Initial pool of samples contains the initial word
    let words = [ initial ];
    let weights = [ 1 ];

    // Try extending each word in the pool by each of the possible choices.
    // If valid extensions don't exceed effort, the new pool is exhaustive.
    // Otherwise a random subset of valid extensions is kept.
    for(let i of range(n)) {
        let advancer = get_advancer(i);
        
        let part = 
            (weights.reduce((a,b)=>a+b,0)/weights.length) *
            (choice_weights.reduce((a,b)=>a+b,0)/n_choices);
        
        // Notionally each todo item is a regularly spaced sequence of points on a time-line
        // starting as todo_starts and with interval 1/todo_weights.    
        let todo = Array.from(range(words.length*n_choices));
        let todo_weights = [ ];
        let todo_starts = [ ]
        for(let j of todo) {
            let weight = weights[j/n_choices>>0] * choice_weights[j%n_choices];
            todo_weights[j] = weight;
            todo_starts[j] = Math.random()/weight;
        }
        
        // We will visit todo items in order of their first instance with time>0
        todo.sort( (a,b) => todo_starts[a]-todo_starts[b] );

        let new_words = [ ];
        let new_index = [ ];

        let end = -1;        
        for(let j of todo) {
            if (new_words.length >= effort) {
                // Sampling ends at this time
                end = todo_starts[j];
                break;
            }
            
            let item = advancer(words[j/n_choices>>0], choices[j%n_choices]);
            if (item !== null) {
                new_words.push(item);
                new_index.push(j);
            }
        }
        
        let new_weights = [ ];
        if (end >= 0) {
            // How many times was each item seen before the end time?
            // Interval is 1/weight, and total occurrences is ceil((end_time-start_time)/interval)
            for(let j of new_index)
                new_weights.push( Math.ceil((end-todo_starts[j])*todo_weights[j]) );
        } else {
            // No subsampling occurred, retain original weights.
            for(let j of new_index)
                new_weights.push( todo_weights[j] );
        }
        
        if (saturated === null && end >= 0)
            saturated = i;

        words = new_words;
        weights = new_weights;
        
        // Make weights add to 1 (and prevent floating point overflow)
        let total = weights.reduce((a, b) => a + b, 0);
        weights = weights.map(weight => weight/total);
        
        if (callback !== null && Date.now() > last_callback + 200) {
            callback({words, weights, saturated});
            last_callback = Date.now();
        }
    }

    return {words, weights, saturated};
}


/* Base class for a layout validity checker. */
class Validity {
    constructor(width, height, initial, choices, choice_weights) {
        this.width = width;
        this.height = height;
        this.initial = initial;
        this.choices = choices;
        this.choice_weights = choice_weights;
    }

    sample(effort, callback) {
        if (callback === null) 
            callback = ()=>null;
        
        let resulter = (result, finished) => {
            let output = { 
                ...result, 
                width:this.width,
                height:this.height,
                choices:this.choices,
                effort:effort, 
                finished:finished
            }
            
            //Only report one sample while running, save some time decoding.
            //if (!finished) output.words = output.words.slice(0,1);
            
            output.words = output.words.map(item => this.get_state_word(item));
            return output;
        };
        function callback2(words) { 
            callback(resulter(words, false)); 
        }

        let words = get_weighted_samples(
            this.initial,
            this.width*this.height, 
            this.choices,
            this.choice_weights,
            effort, 
            this.get_advancer.bind(this),
            callback2);

        return resulter(words, true);
    }
    
    get_state_word(state) { return state; }
}

/* The main validity checker class. */
class Validity_pat extends Validity {
    constructor(width, height, xs, ys, valids, weights) {
        let choices = new Set();
        for(let word of valids)
            for(let choice of word)
                choices.add(choice);
        choices = Array.from(choices);
        
        let choice_weights = choices.map(char => weights[char]);        
        
        super(width, height, "", choices, choice_weights);
        
        this.xs = xs;
        this.ys = ys;
        this.valids = valids;
        
        this.subvalid_cache = { };
    }
    
    get_advancer(i) {
        let check = this.get_check(i);
        
        return (word, choice) => {
            let new_word = word + choice;
            if (!check(new_word)) return null;
            return new_word;
        }
    }
    
    // Returns a function to check words of a given length
    get_check(i) {
        let x_last = i % this.width;
        let y_last = (i / this.width)>>0;
        let checks = [ ];
        
        for(let j=0;j<this.xs.length;j++) {
            let valid_index = [ ];
            let word_index = [ ];

            for(let k=0;k<this.xs.length;k++) {
                let y = y_last + this.ys[k]-this.ys[j];
                let x = x_last + this.xs[k]-this.xs[j];
                if (x < 0 || y < 0 || x >= this.width || y*this.width+x > i)
                    continue;
                valid_index.push(k);
                word_index.push(y*this.width+x);
            }
            
            if (valid_index.length <= 1) 
                continue;
            
            checks.push({word_index, valid_index});
        }
        
        checks.sort( (a,b) => b.word_index.length-a.word_index.length );
        
        // Remove any checks entirely contained in another check.
        // ** Assumes valids have been pruned. **
        let c=0;
        while(c<checks.length) {
            let subsumed = false;
            outer: for(let j=0;j<c;j++) {
                for(let k=0;k<checks[c].word_index.length;k++)
                if (checks[j].word_index.indexOf( checks[c].word_index[k] ) == -1)
                       continue outer;
                
                subsumed = true;
                continue
            }
            
            if (subsumed) {
                checks.splice(c,1);
            } else
                c++;
        }

        for(let check of checks) {        
            let key = JSON.stringify(check.valid_index);
            if (!this.subvalid_cache.hasOwnProperty(key)) {
                let subvalids = new Set();
                for(let valid of this.valids) {
                    subvalids.add(Symbol.for( get_subword(valid, check.valid_index) ));
                }
                this.subvalid_cache[key] = subvalids;
            }
        
            check.subvalids = this.subvalid_cache[key]
        }
        
        return (word) => {
            for(let check of checks)
            if (!check.subvalids.has(Symbol.for( get_subword(word, check.word_index) )))
                return false;
            
            return true;
        }
    }
}



// Perform an inner join on two sets of patterns, using their overlapping positions.
function join(x0s, y0s, valid0s, x1s, y1s, valid1s, max_memory) {    
    let new_xs = x0s.slice();
    let new_ys = y0s.slice();
    let new_valids = [ ];
    let grab1 = [ ];
    let must_match0 = [ ];
    let must_match1 = [ ];
    let memory = 0;

    outer: for(let i of range(x1s.length)) {
        for(let j of range(x0s.length))
        if (x1s[i] == x0s[j] && y1s[i] == y0s[j]) {
            must_match0.push(j);
            must_match1.push(i);
            continue outer;
        }
        grab1.push(i);
        new_xs.push(x1s[i]);
        new_ys.push(y1s[i]);
    }
    
    let subword_valid1 = { };
    for(let valid1 of valid1s) {
       let subword = get_subword(valid1, must_match1);
       if (!subword_valid1.hasOwnProperty(subword))
          subword_valid1[subword] = [ ];
        subword_valid1[subword].push(valid1);
    }
    
    for(let valid0 of valid0s) {
        let subword = get_subword(valid0, must_match0);
        if (!subword_valid1.hasOwnProperty(subword))
            continue;
        for(let valid1 of subword_valid1[subword]) {
            let new_word = valid0 + get_subword(valid1, grab1)
            new_valids.push(new_word);
            
            memory += new_word.length;
            if (memory > max_memory) return null;
        }
    }
    
    return {xs:new_xs, ys:new_ys, valids:new_valids};
}


// Join a set of patterns to an offset version of itself.
function elaborate(x1, y1, xs, ys, valids, max_memory) {
    let x1s = xs.map(x => x+x1);
    let y1s = ys.map(y => y+y1);
    return join(xs,ys,valids, x1s,y1s,valids, max_memory);
}


// Remove any patterns that can not overlap any other patterns (for all possible offsets).
function prune(xs, ys, valids) {
    let all_overlaps = [ ];

    for(let i of range(xs.length))
    for(let j of range(xs.length))
    if (i != j) {
        let overlap = [ xs[j]-xs[i], ys[j]-ys[i] ];
        if (overlap[1]<0 || (overlap[1]==0 && overlap[0]<=0)) continue;
        if (all_overlaps.filter(item=> item[0]==overlap[0] && item[1]==overlap[1]).length) continue;
        all_overlaps.push(overlap);
    }
    
    while(true) { 
        let any = false;
        for(let [x1,y1] of all_overlaps) {
            let must_match0 = [ ];
            let must_match1 = [ ];
            outer: for(let i of range(xs.length)) {
                for(let j of range(xs.length))
                if (xs[i]+x1 == xs[j] && ys[i]+y1 == ys[j]) {
                    must_match0.push(j);
                    must_match1.push(i);
                    continue outer;
                }
            }
            
            let subwords0 = valids.map(valid => get_subword(valid, must_match0));
            let subwords1 = valids.map(valid => get_subword(valid, must_match1));
            let set0 = new Set(subwords0);
            let set1 = new Set(subwords1);
            
            let new_valids = [ ];
            for(let i of range(valids.length))
            if (set1.has(subwords0[i]) && set0.has(subwords1[i]))
                new_valids.push(valids[i]);
                                 
            any = any || (valids.length > new_valids.length);
            valids = new_valids;
        }
        
        if (!any) break;
    }
        
    return valids;
}


// Join several pattern specifications, elaborate and prune.
// Return a Validity object that can produce samples.
function make_validity(width, height, specs, weights, max_memory) {
    if (specs.length == 0) 
        specs = [{xs:[], ys:[], valids:[]}];
    
    let spec = specs[0];
    spec.valids = prune(spec.xs, spec.ys, spec.valids);
    for(let i=1;i<specs.length;i++) {
        spec = join(spec.xs,spec.ys,spec.valids, specs[i].xs,specs[i].ys,specs[i].valids, Infinity);
        spec.valids = prune(spec.xs, spec.ys, spec.valids);
    }
    
    let spec_initial_p = spec.xs.length;
    let spec_initial_n = spec.valids.length;

    let seq = "";
    let new_spec;
    for(let i of range(4)) {
        new_spec = elaborate(1,0, spec.xs, spec.ys, spec.valids, max_memory);
        if (new_spec === null) break;
        spec = new_spec;
        spec.valids = prune(spec.xs, spec.ys, spec.valids);
        seq += "→";
        
        new_spec = elaborate(0,1, spec.xs, spec.ys, spec.valids, max_memory);
        if (new_spec === null) break;
        spec = new_spec;
        spec.valids = prune(spec.xs, spec.ys, spec.valids);
        seq += "↓";
    }
        
    
    let validity = new Validity_pat(width, height, spec.xs, spec.ys, spec.valids, weights);
    
    validity.comment = `Initial ${spec_initial_p}:${spec_initial_n} patterns expanded to ${spec.xs.length}:${spec.valids.length} (${seq}).`;
    
    return validity;
}


// This is called in the worker.
function run_job(width, height, specs, weights, effort, max_memory) {
    let validity = make_validity(width, height, specs, weights, max_memory);

    // Increase effort on failure    
    let result;
    let comment = '';
    let this_effort = effort;
    while(true) {
        result = validity.sample(this_effort, result => self.postMessage({...result, comment:comment + validity.comment}));
        
        if (result.words.length > 0) break;

        this_effort *= 2;
        if (this_effort > effort*128) break;

        comment = `Effort increased to ${this_effort}. `;
    }
    
    self.postMessage({...result, comment:comment + validity.comment});
}
