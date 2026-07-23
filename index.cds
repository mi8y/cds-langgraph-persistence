namespace plugin.langgraph.persistence;

entity Checkpoints {
    key graphName  : String(256) not null;
    key id         : String(256) not null;
    key namespace  : String(256) not null default '';
    key threadId   : String(256) not null;
        parent     : Association to one Checkpoints;
        type       : String(64);
        checkpoint : LargeString not null;
        metadata   : LargeString;
        createdAt  : Timestamp default $now;
        writes     : Composition of many CheckpointWrites
                         on writes.checkpoint = $self;
}

entity CheckpointWrites {
    key checkpoint : Association to Checkpoints;
    key taskId     : String(256) not null;
    key idx        : Integer not null;
        channel    : String(256) not null;
        type       : String(64);
        value      : LargeString;
}

entity StoreItems {
    key namespace  : String(256) not null;
    key id         : String(256) not null;
        createdAt  : Timestamp default $now;
        modifiedAt : Timestamp default $now @cds.on.update: $now;
        values     : Composition of many StoreItemFields
                         on values.item = $self;
}

entity StoreItemFields {
    key item      : Association to StoreItems;
    key name      : String(256) not null;
        value     : String;
        embedding : Vector;
}
