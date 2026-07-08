namespace plugin.langgraph.persistence;

entity Checkpoints {
    key id         : String(256) not null;
    key namespace  : String(256) not null default '';
    key threadId   : String(256) not null;
        parentId   : String(256);
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
