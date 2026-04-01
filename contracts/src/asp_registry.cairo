#[starknet::contract]
pub mod ASPRegistry {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };

    const MAX_ROOT_HISTORY: u32 = 30;

    #[storage]
    struct Storage {
        current_root: u256,
        root_history: starknet::storage::Map<u32, u256>,
        current_root_index: u32,
        total_updates: u32,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RootUpdated: RootUpdatedEvent,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RootUpdatedEvent {
        #[key]
        pub index: u32,
        pub root: u256,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.current_root.write(0);
        self.current_root_index.write(0);
        self.total_updates.write(0);
    }

    #[abi(embed_v0)]
    impl ASPRegistryImpl of super::IASPRegistry<ContractState> {
        fn update_root(ref self: ContractState, new_root: u256) {
            assert(get_caller_address() == self.owner.read(), 'ASP: not owner');

            let idx = (self.current_root_index.read() + 1) % MAX_ROOT_HISTORY;
            self.root_history.write(idx, new_root);
            self.current_root_index.write(idx);
            self.current_root.write(new_root);
            self.total_updates.write(self.total_updates.read() + 1);

            self.emit(RootUpdatedEvent {
                index: self.total_updates.read(),
                root: new_root,
                timestamp: starknet::get_block_timestamp(),
            });
        }

        fn current_root(self: @ContractState) -> u256 {
            self.current_root.read()
        }

        fn is_valid_root(self: @ContractState, root: u256) -> bool {
            if root == 0 { return false; }
            let current = self.current_root_index.read();
            let mut i: u32 = 0;
            let mut found = false;
            while i < MAX_ROOT_HISTORY {
                let idx = if current >= i {
                    current - i
                } else {
                    MAX_ROOT_HISTORY - (i - current)
                };
                if self.root_history.read(idx) == root {
                    found = true;
                    break;
                }
                i += 1;
            };
            found
        }

        fn total_updates(self: @ContractState) -> u32 {
            self.total_updates.read()
        }
    }
}

use starknet::ContractAddress;

#[starknet::interface]
pub trait IASPRegistry<TContractState> {
    fn update_root(ref self: TContractState, new_root: u256);
    fn current_root(self: @TContractState) -> u256;
    fn is_valid_root(self: @TContractState, root: u256) -> bool;
    fn total_updates(self: @TContractState) -> u32;
}
