#[starknet::contract]
pub mod StealthRegistry {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };

    #[storage]
    struct Storage {
        spending_pubkey: starknet::storage::Map<ContractAddress, u256>,
        viewing_pubkey: starknet::storage::Map<ContractAddress, u256>,
        is_registered: starknet::storage::Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        KeysRegistered: KeysRegisteredEvent,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeysRegisteredEvent {
        #[key]
        pub user: ContractAddress,
        pub spending_pubkey: u256,
        pub viewing_pubkey: u256,
    }

    #[abi(embed_v0)]
    impl StealthRegistryImpl of super::IStealthRegistry<ContractState> {
        fn register(ref self: ContractState, spending_pubkey: u256, viewing_pubkey: u256) {
            let caller = get_caller_address();
            assert(spending_pubkey != 0, 'Registry: zero spending key');
            assert(viewing_pubkey != 0, 'Registry: zero viewing key');

            self.spending_pubkey.write(caller, spending_pubkey);
            self.viewing_pubkey.write(caller, viewing_pubkey);
            self.is_registered.write(caller, true);

            self.emit(KeysRegisteredEvent { user: caller, spending_pubkey, viewing_pubkey });
        }

        fn get_keys(self: @ContractState, user: ContractAddress) -> (u256, u256) {
            assert(self.is_registered.read(user), 'Registry: not registered');
            (self.spending_pubkey.read(user), self.viewing_pubkey.read(user))
        }

        fn is_registered(self: @ContractState, user: ContractAddress) -> bool {
            self.is_registered.read(user)
        }
    }
}

use starknet::ContractAddress;

#[starknet::interface]
pub trait IStealthRegistry<TContractState> {
    fn register(ref self: TContractState, spending_pubkey: u256, viewing_pubkey: u256);
    fn get_keys(self: @TContractState, user: ContractAddress) -> (u256, u256);
    fn is_registered(self: @TContractState, user: ContractAddress) -> bool;
}
