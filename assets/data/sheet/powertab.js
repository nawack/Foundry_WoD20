export const datapowertab = {    
    power: {
        werewolf: {
            primary: ["gifts", "rites"],  
        },    
        vampire: {
            primary: ["disciplines", "paths", "combinations", "rituals"],
        },
        mage: {
            primary: ["rotes", "resonances"],
        },
        changeling: {
            primary: ["arts"],
        },
        mortal: {
            primary: [],
        },
        defaultOrder: [
            "disciplines",
            "paths", 
            "combinations",
            "rituals",
            "gifts",
            "rites",
            "rotes",
            "resonances",
            "arts",
            "numinas"
        ],
        unsorted: {
            priority: 99, 
            alwaysLast: true
        }
    }    
}